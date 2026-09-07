# Beacon — Container Status App (Tube Products of India)

## Before doing anything
Read `docs/build-spec.md` in full. It has the domain model, business
logic, roles, and the phased build order. This file is a quick-reference
map, not a replacement for it.

## What this is
A self-hosted PWA giving real-time visibility into every truck at every
plant (9 plants), from gate-in to gate-out, with automatic halting-cost
calculation, photo evidence, and role-based access. Production-grade,
not a prototype — it drives real financial charges and dispute evidence.

## Repo structure
Single repo, three workspaces:
- `frontend/` — React + TypeScript, installable PWA
- `backend/` — Node + Express + TypeScript
- `shared/` — types imported by both (VehicleVisit, VisitEvent, roles,
  API request/response shapes). Define shared types here once — never
  duplicate a type between frontend and backend.

Each of `frontend/` and `backend/` has its own `tsconfig.json`, both
extending a shared base config at the repo root for common strict
compiler settings.

## Non-negotiables
- TypeScript strict everywhere. Never `any`. Never `unknown` without an
  immediate, exhaustive narrowing check. Validate external input with
  Zod and derive types from the schema.
- No cloud services. Everything runs in Docker on company servers.
  The only outbound calls this system makes are to Google/Apple push
  endpoints and the SMS aggregator's API — nothing else leaves the
  network.
- No public internet exposure. Reachable only via the company VPN.
  No public signup — accounts are admin-provisioned only.
- PWA, not native. One React + TypeScript codebase.
- Photos go in MinIO, never in Postgres.
- Every state change is an appended, immutable `VisitEvent`
  (actor + timestamp). Never silently overwrite a status field.
  `gate_in_time`, `load_start_time`, `load_complete_time`, and
  `gate_out_time` are always server-set, never client-supplied.

## Build order
Follow the phased order in `docs/build-spec.md` section 12. Stop after
each phase and confirm before moving to the next — don't build ahead.

## Stack
React + TS (Vite, PWA) · Node + Express + TS · PostgreSQL · MinIO ·
Redis + BullMQ · Socket.IO · Web Push (VAPID) with SMS fallback ·
Nginx · Docker Compose.
