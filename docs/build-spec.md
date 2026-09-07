## 1. What we're building

A production-grade, self-hosted **Progressive Web App** that gives Tube Products of India real-time visibility into every truck at every plant — from gate-in to gate-out — with automatic halting-cost calculation, photo evidence at key stages, role-based access, MIS reporting, and push/SMS notifications.

This replaces a manual, paper/SMS-based process that currently costs ~₹4L/month in avoidable container halting charges across 3 plants. This build targets **all 9 manufacturing plants** from day one of the architecture (even though rollout will be phased).

**This is not a prototype.** It will hold financially-relevant data (halting charges), photo evidence used to resolve real disputes, and will run unattended in production. Build accordingly: typed, tested, validated, and defensive by default — not "make it work and clean up later."

---

## 2. Non-negotiable constraints

Read this section first. These are not preferences — do not deviate without asking.

1. **TypeScript strict everywhere, frontend and backend.** `"strict": true` in every `tsconfig.json`. **Never use `any`. Never use `unknown` without an immediate, exhaustive type-narrowing check.** If a type is genuinely unknown at a boundary (e.g., parsing external JSON), validate it with a schema library (Zod) and derive the type from the schema — don't cast.
2. **No cloud services anywhere in the stack.** No AWS/Azure/GCP managed services (no S3, no RDS, no Cognito, no Lambda). Everything runs in Docker containers on company-owned servers. The only external network calls this system makes are: (a) outbound to Google/Apple push endpoints for Web Push, and (b) outbound to an SMS aggregator's API for the SMS fallback. Nothing else leaves the network.
3. **No public internet exposure.** The application is reachable only via the company's existing VPN. Do not build any internet-facing auth flow (no "forgot password via public email link" assumptions, no public signup). Account creation is admin-provisioned only.
4. **PWA, not native.** Single React + TypeScript codebase, installable on any device (Android, iOS 16.4+, desktop). No React Native, no separate mobile codebase.
5. **Self-hosted, S3-compatible object storage (MinIO)** for all photos. Never store binary image data in PostgreSQL.
6. **Every write is auditable.** No status field is ever silently overwritten. Every state transition is an appended, immutable event with actor + timestamp. This is a hard design constraint, not a nice-to-have — the original business problem this app solves is "who did what, when," and the architecture must reflect that everywhere, not just in one table.

---

## 3. Tech stack

| Layer                   | Choice                                                                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend                | React + TypeScript (strict), Vite, installable PWA (manifest + service worker)                                                                                       |
| Backend                 | Node.js + Express + TypeScript (strict)                                                                                                                              |
| Database                | PostgreSQL (latest stable)                                                                                                                                           |
| Object storage          | MinIO (S3-compatible, self-hosted)                                                                                                                                   |
| Real-time updates       | WebSocket (Socket.IO)                                                                                                                                                |
| Background jobs / queue | Redis + BullMQ (notification delivery, offline-sync reconciliation)                                                                                                  |
| Push notifications      | Web Push protocol (VAPID keys), `web-push` npm package                                                                                                               |
| SMS fallback            | Pluggable adapter interface; initial implementation against an India DLT-compliant aggregator (e.g., MSG91/Kaleyra — confirm final vendor before wiring credentials) |
| Reverse proxy           | Nginx                                                                                                                                                                |
| Containerization        | Docker + Docker Compose (single docker-compose stack: app, postgres, minio, redis, nginx)                                                                            |
| Validation              | Zod (both frontend form validation and backend request validation, shared schemas where practical)                                                                   |
| Auth                    | JWT-based session, role + plant scoping enforced in middleware on every request                                                                                      |

---

## 4. Domain model

Build this as the foundation before any UI. Suggested schema (adjust field types/constraints as needed, but keep the entities and relationships):

```
Organization
  id, name

Plant
  id, organization_id, name, code, timezone

Gate  (optional if a plant has multiple physical gates; otherwise fold into Plant)
  id, plant_id, name

User
  id, plant_id (nullable for Corporate Admin), role, name, phone, email,
  password_hash, is_active, created_at

  role enum: SECURITY | LOADING_OPERATOR | LOGISTICS | CORPORATE_ADMIN
  -- Viewer is NOT a User row — see section 6

Vehicle
  id, vehicle_no (normalized: uppercase, no whitespace, UNIQUE),
  transporter_name (nullable), created_at

VehicleVisit                     -- one row per gate-in -> gate-out cycle
  id, vehicle_id, plant_id, operation_type (INBOUND | OUTBOUND),
  customer, location,
  driver_no,
  gate_in_time, load_start_time, load_complete_time, gate_out_time,
  current_status (ARRIVED | LOADING | UNLOADING | LOADED | UNLOADED | EXITED | NEEDS_TAGGING),
  computed_halting_cost (derived/cached, recalculated on read or via scheduled job),
  created_at, updated_at

VisitEvent                       -- APPEND-ONLY audit trail, source of truth
  id, visit_id, event_type, actor_user_id (nullable — null only for system/auto events),
  timestamp, photo_object_key (nullable, points to MinIO), metadata (jsonb),
  created_at

HaltingRateSlab                  -- versioned, so historical costs never change retroactively
  id, plant_id (nullable = applies org-wide unless overridden per plant),
  day_number (1, 2, 3, 4...), rate,
  effective_from, effective_to (nullable = still active)

PushSubscription
  id, user_id, endpoint, p256dh_key, auth_key, device_label (nullable),
  created_at, last_seen_at

NotificationLog
  id, visit_id, user_id, channel (PUSH | SMS), trigger_event,
  status (QUEUED | SENT | FAILED | RETRYING), attempts, last_error (nullable),
  created_at, sent_at (nullable)

PlantAccessCode                  -- for Viewer mode
  plant_id, code (hashed or plain per your risk tolerance — VPN already gates this),
  updated_at
```

**Every table that isn't org-wide config carries `plant_id`** (directly or via `VehicleVisit`). Enforce plant scoping at the query layer, not just in the UI — a Logistics user for Plant A must get a 403, not a silently empty result, if they somehow query Plant B.

---

## 5. Core business logic (build and unit-test this before UI)

### 5.1 Vehicle number normalization
```typescript
function normalizeVehicleNo(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}
```
Apply on every write and every lookup. Never store or match on raw user input.

### 5.2 Reconciliation (upsert on Vehicle No)
Two independent entry paths must merge into one `VehicleVisit`:
- **Pre-registration** (Logistics enters Customer + Location before or without a gate event yet)
- **Gate entry** (Security logs Vehicle No + Driver No; server sets `gate_in_time`)

Whichever arrives first creates the `VehicleVisit` row (status `NEEDS_TAGGING` if incomplete); the second arrival updates the same row via `vehicle_no` + an open/incomplete visit for that vehicle. Use a Postgres `ON CONFLICT` pattern or an explicit find-open-visit-then-update pattern — either is fine, but it must be atomic (no race condition where two near-simultaneous submissions create duplicate visits for the same truck).

**`gate_in_time`, `load_start_time`, `load_complete_time`, and `gate_out_time` are always server-set at the moment of the relevant action. Never accept these as client-supplied values**, even from a trusted role. This is the single most important rule in the whole system — it's what makes FIFO ordering and halting-cost calculation trustworthy.

### 5.3 Vehicle lifecycle state machine
```
ARRIVED → (LOADING | UNLOADING) → (LOADED | UNLOADED) → EXITED
```
- `ARRIVED`: set by Security. Requires an attached empty-truck photo (see 5.5).
- `LOADING`/`UNLOADING`: set by Loading Operator. Sets `load_start_time`.
- `LOADED`/`UNLOADED`: set by Loading Operator. Requires an attached loaded-truck photo. Sets `load_complete_time`.
- `EXITED`: set by Security. Sets `gate_out_time`. Terminal state.

Reject any transition that skips a stage or moves backward. Each transition writes one `VisitEvent` row; `VehicleVisit.current_status` is a denormalized convenience field kept in sync, but `VisitEvent` is the source of truth if they ever disagree.

### 5.4 Ageing flag
A visit is "ageing" (shown in red on the live queue) when `now() - gate_in_time > 12 hours` and `current_status != 'EXITED'`. Make the threshold a config value (`plant.ageing_threshold_hours`, default 12), not a hardcoded constant.

### 5.5 Photo requirements
- Security cannot mark `ARRIVED` without an attached photo (empty truck).
- Loading Operator cannot mark `LOADED`/`UNLOADED` without an attached photo (loaded truck).
- Photos upload to MinIO; the `VehicleVisit`/`VisitEvent` stores only the object key, never binary data or a raw MinIO URL with embedded credentials. Serve photos through a backend-signed, time-limited URL or an authenticated proxy endpoint — never a public bucket.
- Validate file type (image only) and size (set a sane max, e.g., 8MB) before upload.
- Support capture via `getUserMedia()` (webcam/phone camera) AND file upload fallback, since Security's gate PC may or may not have a camera attached — confirm this per plant during discovery, but build both paths regardless.

### 5.6 Halting cost engine
Given a `VehicleVisit` and the applicable `HaltingRateSlab` rows (by plant, filtered to `effective_from <= gate_in_time < effective_to OR effective_to IS NULL`):

```
day 1 (0–24h from gate_in_time):  free
day 2 (24–48h):                   rate for day_number=2
day 3 (48–72h):                   rate for day_number=3
day 4+:                           rate for day_number=4 (or highest configured day_number), repeating
```
Default seed values: day 2 = ₹2,000, day 3 = ₹2,500, day 4+ = ₹2,500/day. **These must be configurable per plant by Corporate Admin, not hardcoded**, since they're contractual and will change.

Cost calculation should be computable **live** (for the current running visit, to show "cost so far" on the queue) and **frozen** once `gate_out_time` is set (store the final computed value on `VehicleVisit.computed_halting_cost` at exit time, so it never silently changes if rate slabs are edited later).

---

## 6. Roles & access

| Role             | Login                       | Scope                                                        | Can do                                                                                                       |
| ---------------- | --------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Security         | Named account, gate PC      | Own plant                                                    | Log arrival (Vehicle No, Driver No, empty-truck photo); log exit                                             |
| Loading Operator | Named account, phone/tablet | Own plant                                                    | Update loading/unloading status; attach loaded-truck photo                                                   |
| Logistics        | Named account               | Own plant                                                    | Pre-register Customer/Location; edit any visit in their plant; view plant MIS reports; receive notifications |
| Corporate Admin  | Named account               | All plants                                                   | Manage users, plants, gates, rate slabs, plant access codes; cross-plant MIS rollup; full read/write         |
| Viewer           | **No account**              | One plant, selected via dropdown, gated by `PlantAccessCode` | Read-only live status board for that plant only                                                              |

**Landing screen flow:**
```
"Who are you?"
  → Security / Loading Operator / Logistics / Corporate Admin → login screen
  → Viewer → plant dropdown → access code prompt → read-only live board
```
No public self-registration for any named role. Corporate Admin creates users via an admin panel; new users get a first-login/set-password flow (do not email this externally — it's an internal tool; decide the delivery mechanism, e.g., admin communicates the temporary credential directly, or build an internal-only reset flow).

Enforce role + plant scoping **in Express middleware on every route**, not just in the React UI. Write an integration test that confirms a Loading Operator token cannot read another plant's data via direct API call, even if the UI would never construct that request.

---

## 7. Notifications

**Push-first, SMS as fallback** — build both, prioritize push.

### 7.1 Web Push (primary)
- Generate VAPID keypair once at setup; store the private key as a server secret (never in the repo).
- `PushSubscription` table stores one row per device a user has granted permission on (a user may have multiple).
- Service worker registers a `push` event handler that calls `showNotification()` and a `notificationclick` handler that deep-links into the specific `VehicleVisit` record.
- Ask for notification permission **contextually** — after first successful login, with a one-line explanation — not on first page load.
- Handle `410 Gone` responses from the push service by deleting the dead subscription, not retrying indefinitely.
- **iOS note:** push only works if the user has installed the PWA via "Add to Home Screen" (iOS 16.4+). Build a clear, persistent "Install this app" prompt into the post-login experience — this isn't optional polish on iOS, it's required for notifications to work at all.

### 7.2 SMS (fallback)
- Adapter pattern: define an interface (`sendSms(to, templateId, params)`) so the aggregator is swappable.
- DLT template registration happens outside this codebase (a compliance/ops task) — but build the adapter to accept a `templateId`, not free-form text, so it's ready for DLT-approved templates from day one.
- A notification is sent via SMS when: the recipient has no active push subscription, OR the push delivery attempt fails/errors after retries.

### 7.3 Delivery pipeline (both channels)
```
Event occurs (arrival / status update / exit)
   → VisitEvent written (always happens, synchronously, this is the source of truth)
   → notification job enqueued (BullMQ)
   → worker resolves recipients (by plant + role — e.g., "Logistics + Loading team for this plant")
   → for each recipient: attempt Push; on failure/absence, attempt SMS
   → log outcome to NotificationLog with retry count
```
This must be decoupled from the request/response cycle of the triggering action — a slow or failed notification must never delay or block the gate-entry/status-update/exit API response.

**Triggers → recipients** (confirm exact recipient list against current org chart during discovery, but this is the baseline):
| Trigger                          | Notify                                    |
| -------------------------------- | ----------------------------------------- |
| Truck arrives (ARRIVED)          | Logistics + Loading Operators, that plant |
| Loading/unloading status updated | Logistics, that plant                     |
| Truck exits (EXITED)             | Logistics, that plant                     |

---

## 8. MIS reporting

- **Plant-level (Logistics role):** halting cost by day/week/month, average turnaround time (gate-in to gate-out), FIFO-compliance % (were vehicles loaded in arrival order?), vehicle counts by current status.
- **Corporate rollup (Admin role):** same metrics aggregated and comparable across all 9 plants, sortable by highest-cost plant, exportable to CSV/Excel.
- Reports should be computed from `VehicleVisit` + `VisitEvent`, not a separately-maintained summary table, so they're always consistent with the live data — cache/materialize for performance if needed, but don't let it drift from source.

---

## 9. PWA requirements

- Valid `manifest.json` (name, icons at multiple sizes, `display: standalone`, theme colors matching the deck's palette — navy `#16233F` / orange `#E85D25`).
- Service worker with:
  - Offline caching of the app shell (so it opens even with no connectivity).
  - **Offline-capable submission queue** for gate-entry and status-update forms: if a Security/Loading Operator submission fails due to no connectivity, save it locally (IndexedDB) with a client-generated idempotency key (UUID), and retry on reconnect. The server must dedupe on that idempotency key — never create two visits from one retried submission.
  - Push handling as described in section 7.1.
- Works correctly on: Android Chrome, iOS Safari (16.4+), and desktop Chrome/Edge.

---

## 10. Security & hardening

- Rate limiting on all endpoints, tighter on login and any write endpoint.
- Account lockout after repeated failed logins.
- Password hashing (bcrypt/argon2), no plaintext anywhere, ever.
- Structured request validation (Zod) on every endpoint — reject malformed input before it touches business logic.
- CORS locked to the known frontend origin(s) only.
- Security headers via Nginx/Helmet (CSP, X-Frame-Options, etc.).
- No secrets in the repo — `.env` for local dev, real secrets injected at deploy time; provide a `.env.example` with every required variable documented.
- Structured logging (not just `console.log`) so issues are traceable in production; don't log secrets or full photo/PII payloads.

---

## 11. Deployment

- `docker-compose.yml` defining: `app` (Node/Express + built React static files served via the same container or a separate Nginx-served static bundle — your call on structure, but keep it simple to operate), `postgres`, `minio`, `redis`, `nginx`.
- Nginx as the only entry point; internal services (`postgres`, `minio`, `redis`) never exposed outside the Docker network.
- Health check endpoints for `app` (and rely on Postgres/MinIO/Redis's own health checks) so the stack is verifiable after deploy.
- Migration tooling for PostgreSQL schema changes (e.g., `node-pg-migrate`, Prisma Migrate, or Drizzle — pick one and use it consistently; don't hand-edit schema in production).
- Document the manual steps IT will need: VPN routing to the server, internal TLS certificate placement, environment variable configuration, initial Corporate Admin account bootstrap.

---

## 12. Suggested build order

Build in this order — each phase should be runnable/demoable before moving to the next:

1. **Foundations** — repo scaffold (frontend + backend, strict TS configs), Docker Compose skeleton (Postgres + MinIO + Redis running), database schema + migrations for all core tables.
2. **Auth + roles** — login, JWT issuance, role/plant-scoping middleware, seed script for a Corporate Admin + one test plant.
3. **Core lifecycle API** — gate-entry endpoint, pre-registration/tagging endpoint (with the upsert/reconciliation logic), status-update endpoints for each lifecycle stage, photo upload to MinIO.
4. **Live queue + WebSocket** — the read endpoint + Socket.IO broadcast on every write; this is the first real end-to-end demo (Security logs a truck, it appears live).
5. **Halting cost engine** — rate slab CRUD (Admin), live cost calculation, freeze-on-exit behavior.
6. **Frontend: entry forms + live board** — Security's gate form, Loading Operator's status form, the plant status board (including Viewer mode with plant selection + access code).
7. **PWA shell** — manifest, service worker, offline queueing, installability.
8. **Notifications** — VAPID setup, push subscription flow, BullMQ worker, SMS adapter (can stub the actual SMS provider call behind the interface until DLT/vendor is finalized).
9. **MIS reporting** — plant-level and corporate rollup views/endpoints.
10. **Hardening pass** — rate limiting, audit review, load-test the gate-entry endpoint for concurrent submissions, offline-sync edge cases (duplicate detection, clock skew).

---

## 13. Definition of done for MVP (pilot-ready)

- A Security user can log a truck's arrival with a photo from a gate PC, and it appears instantly on the live queue for that plant.
- A Loading Operator can move it through loading → loaded with a photo, and Logistics sees it reflected live.
- A Logistics user can pre-register a truck before it arrives, and it correctly merges with the later gate entry (test this race condition explicitly).
- The halting cost for a truck that's been waiting 30 hours shows ₹2,000 correctly, and a truck waiting 50 hours shows ₹4,500.
- A truck waiting 13 hours shows the red ageing flag.
- A Viewer with no account can select a plant (with the correct access code) and see the live board, read-only.
- Logistics receives a push notification within a few seconds of a truck arriving (test on both Android and installed-iOS).
- If push fails, an SMS is attempted instead (can be tested against a sandbox/mock SMS provider).
- All of the above works when the app is installed to a home screen and reopened with no network, showing cached state, then syncing once reconnected.
- A Loading Operator's API token, used directly (bypassing the UI), cannot read or write data for a plant they're not assigned to.

---

## 14. Open questions to confirm with the user before/while building

- Final SMS aggregator vendor (affects the adapter's concrete implementation, not its interface).
- Whether gate PCs have a webcam/IP camera or Security will use a phone for photo capture (build both paths regardless, but confirm which is primary per plant).
- Exact recipient list for each notification trigger, per plant (may not always be "all Logistics users" — confirm).
- Whether `PlantAccessCode` should be a single shared code per plant or something more granular.
- Pilot plant selection and rollout batch order (does not block build, but affects seed data/testing priorities).
