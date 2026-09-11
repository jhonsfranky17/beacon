import type { VisitOperationType, VisitStatus } from "@beacon/shared";

/**
 * build-spec §5.3:
 *   ARRIVED -> (LOADING | UNLOADING) -> (LOADED | UNLOADED) -> EXITED
 * GATE_IN also covers the reconciliation-merge case: a pre-registered visit
 * sitting at NEEDS_TAGGING transitions to ARRIVED when the truck physically
 * gate-enters. It is never called for a brand-new visit (no existing row) —
 * the service layer inserts those directly at ARRIVED.
 */
export type VisitAction = "GATE_IN" | "LOADING_START" | "LOADING_COMPLETE" | "EXIT";

export function canTransition(current: VisitStatus, action: VisitAction): boolean {
  switch (action) {
    case "GATE_IN":
      return current === "NEEDS_TAGGING";
    case "LOADING_START":
      return current === "ARRIVED";
    case "LOADING_COMPLETE":
      return current === "LOADING" || current === "UNLOADING";
    case "EXIT":
      return current === "LOADED" || current === "UNLOADED";
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

/**
 * LOADING vs UNLOADING and LOADED vs UNLOADED are derived from the visit's
 * own operation_type, never chosen by the caller.
 */
export function nextStatusFor(
  action: VisitAction,
  operationType: VisitOperationType,
): VisitStatus {
  switch (action) {
    case "GATE_IN":
      return "ARRIVED";
    case "LOADING_START":
      return operationType === "OUTBOUND" ? "LOADING" : "UNLOADING";
    case "LOADING_COMPLETE":
      return operationType === "OUTBOUND" ? "LOADED" : "UNLOADED";
    case "EXIT":
      return "EXITED";
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
