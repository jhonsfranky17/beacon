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
