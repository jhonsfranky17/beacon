import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  USER_ROLES,
  notificationChannelSchema,
  notificationStatusSchema,
  visitOperationTypeSchema,
  visitStatusSchema,
} from "@beacon/shared";

// ---------------------------------------------------------------------------
// Enums (build-spec §4, §6) — string sets are owned by @beacon/shared so the
// DB, backend, and frontend never disagree on the allowed values.
// ---------------------------------------------------------------------------

export const userRoleEnum = pgEnum("user_role", USER_ROLES);
export const visitOperationTypeEnum = pgEnum(
  "visit_operation_type",
  visitOperationTypeSchema.options,
);
export const visitStatusEnum = pgEnum(
  "visit_status",
  visitStatusSchema.options,
);
export const notificationChannelEnum = pgEnum(
  "notification_channel",
  notificationChannelSchema.options,
);
export const notificationStatusEnum = pgEnum(
  "notification_status",
  notificationStatusSchema.options,
);

// ---------------------------------------------------------------------------
// Organization / Plant / Gate
// ---------------------------------------------------------------------------

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const plants = pgTable(
  "plants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    // build-spec §5.4 — configurable per plant, default 12.
    ageingThresholdHours: integer("ageing_threshold_hours")
      .notNull()
      .default(12),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("plants_code_unique").on(table.code)],
);

export const gates = pgTable("gates", {
  id: uuid("id").primaryKey().defaultRandom(),
  plantId: uuid("plant_id")
    .notNull()
    .references(() => plants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable only for Corporate Admin, per build-spec §4/§6.
    plantId: uuid("plant_id").references(() => plants.id, {
      onDelete: "restrict",
    }),
    role: userRoleEnum("role").notNull(),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    passwordHash: text("password_hash").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("users_phone_unique").on(table.phone)],
);

// ---------------------------------------------------------------------------
// Vehicle / VehicleVisit / VisitEvent
// ---------------------------------------------------------------------------

export const vehicles = pgTable(
  "vehicles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Always normalizeVehicleNo() before write/lookup — see @beacon/shared.
    vehicleNo: text("vehicle_no").notNull(),
    transporterName: text("transporter_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("vehicles_vehicle_no_unique").on(table.vehicleNo)],
);

export const vehicleVisits = pgTable("vehicle_visits", {
  id: uuid("id").primaryKey().defaultRandom(),
  vehicleId: uuid("vehicle_id")
    .notNull()
    .references(() => vehicles.id, { onDelete: "restrict" }),
  plantId: uuid("plant_id")
    .notNull()
    .references(() => plants.id, { onDelete: "restrict" }),
  operationType: visitOperationTypeEnum("operation_type").notNull(),
  customer: text("customer"),
  location: text("location"),
  driverNo: text("driver_no"),
  // These four timestamps are always server-set at the moment of the
  // relevant action (build-spec §5.2) — never accept them as client input,
  // even from a trusted role. Enforced in the API layer, not here.
  gateInTime: timestamp("gate_in_time", { withTimezone: true }),
  loadStartTime: timestamp("load_start_time", { withTimezone: true }),
  loadCompleteTime: timestamp("load_complete_time", { withTimezone: true }),
  gateOutTime: timestamp("gate_out_time", { withTimezone: true }),
  currentStatus: visitStatusEnum("current_status")
    .notNull()
    .default("NEEDS_TAGGING"),
  // Frozen at gate-out time (build-spec §5.6); null while the visit is open.
  computedHaltingCost: numeric("computed_halting_cost", {
    precision: 12,
    scale: 2,
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const visitEvents = pgTable("visit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  visitId: uuid("visit_id")
    .notNull()
    .references(() => vehicleVisits.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  // Null only for system/auto events (build-spec §4).
  actorUserId: uuid("actor_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  timestamp: timestamp("timestamp", { withTimezone: true })
    .notNull()
    .defaultNow(),
  photoObjectKey: text("photo_object_key"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// HaltingRateSlab
// ---------------------------------------------------------------------------

export const haltingRateSlabs = pgTable("halting_rate_slabs", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Null = applies org-wide unless overridden per plant (build-spec §4).
  plantId: uuid("plant_id").references(() => plants.id, {
    onDelete: "cascade",
  }),
  dayNumber: integer("day_number").notNull(),
  rate: numeric("rate", { precision: 12, scale: 2 }).notNull(),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
  // Null = still active.
  effectiveTo: timestamp("effective_to", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// PushSubscription / NotificationLog
// ---------------------------------------------------------------------------

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dhKey: text("p256dh_key").notNull(),
    authKey: text("auth_key").notNull(),
    deviceLabel: text("device_label"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("push_subscriptions_endpoint_unique").on(table.endpoint),
  ],
);

export const notificationLogs = pgTable("notification_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  visitId: uuid("visit_id")
    .notNull()
    .references(() => vehicleVisits.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  channel: notificationChannelEnum("channel").notNull(),
  triggerEvent: text("trigger_event").notNull(),
  status: notificationStatusEnum("status").notNull().default("QUEUED"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// PlantAccessCode (Viewer mode, build-spec §6)
// ---------------------------------------------------------------------------

export const plantAccessCodes = pgTable("plant_access_codes", {
  plantId: uuid("plant_id")
    .primaryKey()
    .references(() => plants.id, { onDelete: "cascade" }),
  // VPN already gates network access; code is hashed at the app layer.
  code: text("code").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
