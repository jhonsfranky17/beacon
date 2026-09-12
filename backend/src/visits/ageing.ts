import type { VisitStatus } from "@beacon/shared";

/**
 * build-spec §5.4 — a visit is "ageing" when it's been more than the
 * plant's configured threshold since gate-in and it hasn't exited yet.
 * Computed live at read time; never stored.
 */
export function isAgeing(
  gateInTime: Date | null,
  currentStatus: VisitStatus,
  thresholdHours: number,
): boolean {
  if (gateInTime === null) return false;
  if (currentStatus === "EXITED") return false;

  const elapsedMs = Date.now() - gateInTime.getTime();
  const thresholdMs = thresholdHours * 60 * 60 * 1000;
  return elapsedMs > thresholdMs;
}
