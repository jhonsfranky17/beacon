import type { Server } from "socket.io";
import { VISIT_CHANGED_EVENT, type LiveVisitDto } from "@beacon/shared";
import { isAgeing } from "../visits/ageing";
import { toVisitDto, type VehicleVisitRow } from "../visits/visitService";
import { ADMIN_ROOM, plantRoom } from "./rooms";

let ioInstance: Server | null = null;

/** Called once at startup (see src/index.ts). */
export function setIoInstance(io: Server): void {
  ioInstance = io;
}

/** Only used by realtime.test.ts to reset state between test runs. */
export function clearIoInstance(): void {
  ioInstance = null;
}

/**
 * No-ops if no socket server has been wired up — every existing REST test
 * from Phases 2/3 keeps passing unmodified; only realtime.test.ts needs to
 * call setIoInstance() first.
 */
export function broadcastVisitUpdate(
  visit: VehicleVisitRow,
  vehicleNo: string,
  ageingThresholdHours: number,
): void {
  if (!ioInstance) return;

  const payload: LiveVisitDto = {
    ...toVisitDto(visit, vehicleNo),
    isAgeing: isAgeing(visit.gateInTime, visit.currentStatus, ageingThresholdHours),
  };

  ioInstance.to(plantRoom(visit.plantId)).to(ADMIN_ROOM).emit(VISIT_CHANGED_EVENT, payload);
}
