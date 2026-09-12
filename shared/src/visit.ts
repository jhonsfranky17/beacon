import { z } from "zod";

/** build-spec §4 VehicleVisit.operation_type */
export const visitOperationTypeSchema = z.enum(["INBOUND", "OUTBOUND"]);
export type VisitOperationType = z.infer<typeof visitOperationTypeSchema>;

/**
 * build-spec §4 VehicleVisit.current_status and §5.3 lifecycle state machine:
 *   ARRIVED -> (LOADING | UNLOADING) -> (LOADED | UNLOADED) -> EXITED
 * NEEDS_TAGGING is the pre-registration-only state before a gate event exists.
 */
export const visitStatusSchema = z.enum([
  "NEEDS_TAGGING",
  "ARRIVED",
  "LOADING",
  "UNLOADING",
  "LOADED",
  "UNLOADED",
  "EXITED",
]);
export type VisitStatus = z.infer<typeof visitStatusSchema>;

/** build-spec §4 NotificationLog.channel */
export const notificationChannelSchema = z.enum(["PUSH", "SMS"]);
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

/** build-spec §4 NotificationLog.status */
export const notificationStatusSchema = z.enum([
  "QUEUED",
  "SENT",
  "FAILED",
  "RETRYING",
]);
export type NotificationStatus = z.infer<typeof notificationStatusSchema>;

/** POST /visits/gate-in — Security. Non-file fields (photo is multipart). */
export const gateInRequestSchema = z.object({
  vehicleNo: z.string().min(1),
  driverNo: z.string().min(1),
  operationType: visitOperationTypeSchema,
});
export type GateInRequest = z.infer<typeof gateInRequestSchema>;

/** POST /visits/pre-register — Logistics. */
export const preRegisterRequestSchema = z.object({
  vehicleNo: z.string().min(1),
  customer: z.string().min(1),
  location: z.string().min(1),
  operationType: visitOperationTypeSchema,
});
export type PreRegisterRequest = z.infer<typeof preRegisterRequestSchema>;

/** Shape returned by visit read endpoints. */
export const visitDtoSchema = z.object({
  id: z.string().uuid(),
  vehicleId: z.string().uuid(),
  vehicleNo: z.string(),
  plantId: z.string().uuid(),
  operationType: visitOperationTypeSchema,
  customer: z.string().nullable(),
  location: z.string().nullable(),
  driverNo: z.string().nullable(),
  gateInTime: z.string().datetime().nullable(),
  loadStartTime: z.string().datetime().nullable(),
  loadCompleteTime: z.string().datetime().nullable(),
  gateOutTime: z.string().datetime().nullable(),
  currentStatus: visitStatusSchema,
  computedHaltingCost: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type VisitDto = z.infer<typeof visitDtoSchema>;

/** Shape of one row in a visit's audit trail. */
export const visitEventDtoSchema = z.object({
  id: z.string().uuid(),
  eventType: z.string(),
  actorUserId: z.string().uuid().nullable(),
  timestamp: z.string().datetime(),
  photoObjectKey: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
});
export type VisitEventDto = z.infer<typeof visitEventDtoSchema>;

/**
 * build-spec §5.4 ageing flag, computed live — not stored. Used by both the
 * live-queue read endpoint and the realtime broadcast payload so they never
 * disagree on shape.
 */
export const liveVisitDtoSchema = visitDtoSchema.extend({
  isAgeing: z.boolean(),
});
export type LiveVisitDto = z.infer<typeof liveVisitDtoSchema>;

/** Socket.IO event name — defined once so client and server can't drift. */
export const VISIT_CHANGED_EVENT = "visit:changed";
