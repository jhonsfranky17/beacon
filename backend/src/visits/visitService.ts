import { and, eq, ne } from "drizzle-orm";
import type { VisitDto, VisitOperationType } from "@beacon/shared";
import { normalizeVehicleNo } from "@beacon/shared";
import { db } from "../db/client";
import { vehicles, vehicleVisits, visitEvents } from "../db/schema";
import { uploadPhoto, type PhotoKind } from "../storage/photos";
import { canTransition, nextStatusFor, type VisitAction } from "./stateMachine";

export type VehicleVisitRow = typeof vehicleVisits.$inferSelect;

export class VisitNotFoundError extends Error {}
export class InvalidTransitionError extends Error {}

export async function getVisitById(
  visitId: string,
): Promise<{ visit: VehicleVisitRow; vehicleNo: string } | undefined> {
  const [row] = await db
    .select({ visit: vehicleVisits, vehicleNo: vehicles.vehicleNo })
    .from(vehicleVisits)
    .innerJoin(vehicles, eq(vehicleVisits.vehicleId, vehicles.id))
    .where(eq(vehicleVisits.id, visitId))
    .limit(1);
  return row;
}

export function toVisitDto(visit: VehicleVisitRow, vehicleNo: string): VisitDto {
  return {
    id: visit.id,
    vehicleId: visit.vehicleId,
    vehicleNo,
    plantId: visit.plantId,
    operationType: visit.operationType,
    customer: visit.customer,
    location: visit.location,
    driverNo: visit.driverNo,
    gateInTime: visit.gateInTime?.toISOString() ?? null,
    loadStartTime: visit.loadStartTime?.toISOString() ?? null,
    loadCompleteTime: visit.loadCompleteTime?.toISOString() ?? null,
    gateOutTime: visit.gateOutTime?.toISOString() ?? null,
    currentStatus: visit.currentStatus,
    computedHaltingCost: visit.computedHaltingCost,
    createdAt: visit.createdAt.toISOString(),
    updatedAt: visit.updatedAt.toISOString(),
  };
}

const UNIQUE_VIOLATION_CODE = "23505";

function isUniqueViolationError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return (error as { code: unknown }).code === UNIQUE_VIOLATION_CODE;
}

/**
 * Retries once on the vehicle_visits_open_visit_unique index violation —
 * happens only when two requests race to CREATE the first open visit for a
 * brand-new vehicle+plant pair (see build-spec §5.2). The retry re-runs the
 * whole transaction, which will now see the winner's committed row and take
 * the update branch instead.
 */
async function withRetryOnConflict<T>(fn: () => Promise<T>, attemptsLeft = 3): Promise<T> {
  try {
    return await fn();
  } catch (error: unknown) {
    if (attemptsLeft > 1 && isUniqueViolationError(error)) {
      return withRetryOnConflict(fn, attemptsLeft - 1);
    }
    throw error;
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function findOrCreateVehicle(tx: Tx, rawVehicleNo: string): Promise<string> {
  const vehicleNo = normalizeVehicleNo(rawVehicleNo);

  const [existing] = await tx
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(eq(vehicles.vehicleNo, vehicleNo))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await tx
    .insert(vehicles)
    .values({ vehicleNo })
    .onConflictDoNothing({ target: vehicles.vehicleNo })
    .returning({ id: vehicles.id });
  if (created) return created.id;

  // Another request created it concurrently between our SELECT and INSERT.
  const [raceWinner] = await tx
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(eq(vehicles.vehicleNo, vehicleNo))
    .limit(1);
  if (!raceWinner) throw new Error(`Failed to find or create vehicle ${vehicleNo}`);
  return raceWinner.id;
}

async function findOpenVisit(
  tx: Tx,
  vehicleId: string,
  plantId: string,
): Promise<VehicleVisitRow | undefined> {
  const [row] = await tx
    .select()
    .from(vehicleVisits)
    .where(
      and(
        eq(vehicleVisits.vehicleId, vehicleId),
        eq(vehicleVisits.plantId, plantId),
        ne(vehicleVisits.currentStatus, "EXITED"),
      ),
    )
    .for("update")
    .limit(1);
  return row;
}

export interface GateInInput {
  vehicleNo: string;
  driverNo: string;
  operationType: VisitOperationType;
  plantId: string;
  actorUserId: string;
  photo: { buffer: Buffer; mimeType: string };
}

export function upsertVisitForGateIn(input: GateInInput): Promise<VehicleVisitRow> {
  return withRetryOnConflict(() =>
    db.transaction(async (tx) => {
      const vehicleId = await findOrCreateVehicle(tx, input.vehicleNo);
      const existing = await findOpenVisit(tx, vehicleId, input.plantId);
      const now = new Date();

      let visit: VehicleVisitRow | undefined;
      if (existing) {
        if (!canTransition(existing.currentStatus, "GATE_IN")) {
          throw new InvalidTransitionError(
            `Cannot gate-in a visit currently in status ${existing.currentStatus}`,
          );
        }
        [visit] = await tx
          .update(vehicleVisits)
          .set({ driverNo: input.driverNo, gateInTime: now, currentStatus: "ARRIVED", updatedAt: now })
          .where(eq(vehicleVisits.id, existing.id))
          .returning();
      } else {
        [visit] = await tx
          .insert(vehicleVisits)
          .values({
            vehicleId,
            plantId: input.plantId,
            operationType: input.operationType,
            driverNo: input.driverNo,
            gateInTime: now,
            currentStatus: "ARRIVED",
          })
          .returning();
      }
      if (!visit) throw new Error("Failed to upsert visit for gate-in");

      const photoObjectKey = await uploadPhoto(
        input.photo.buffer,
        input.photo.mimeType,
        visit.id,
        "empty-truck",
      );

      await tx.insert(visitEvents).values({
        visitId: visit.id,
        eventType: "ARRIVED",
        actorUserId: input.actorUserId,
        timestamp: now,
        photoObjectKey,
      });

      return visit;
    }),
  );
}

export interface PreRegisterInput {
  vehicleNo: string;
  customer: string;
  location: string;
  operationType: VisitOperationType;
  plantId: string;
  actorUserId: string;
}

export function upsertVisitForPreRegistration(input: PreRegisterInput): Promise<VehicleVisitRow> {
  return withRetryOnConflict(() =>
    db.transaction(async (tx) => {
      const vehicleId = await findOrCreateVehicle(tx, input.vehicleNo);
      const existing = await findOpenVisit(tx, vehicleId, input.plantId);
      const now = new Date();

      // Pre-registration only ever touches customer/location — it never
      // validates or changes current_status, so it is safe to call even
      // after the truck has already gate-entered (build-spec §6: Logistics
      // may "edit any visit in their plant").
      let visit: VehicleVisitRow | undefined;
      if (existing) {
        [visit] = await tx
          .update(vehicleVisits)
          .set({ customer: input.customer, location: input.location, updatedAt: now })
          .where(eq(vehicleVisits.id, existing.id))
          .returning();
      } else {
        [visit] = await tx
          .insert(vehicleVisits)
          .values({
            vehicleId,
            plantId: input.plantId,
            operationType: input.operationType,
            customer: input.customer,
            location: input.location,
            currentStatus: "NEEDS_TAGGING",
          })
          .returning();
      }
      if (!visit) throw new Error("Failed to upsert visit for pre-registration");

      await tx.insert(visitEvents).values({
        visitId: visit.id,
        eventType: "PRE_REGISTERED",
        actorUserId: input.actorUserId,
        timestamp: now,
        metadata: { customer: input.customer, location: input.location },
      });

      return visit;
    }),
  );
}

function timeFieldFor(action: Exclude<VisitAction, "GATE_IN">, now: Date) {
  switch (action) {
    case "LOADING_START":
      return { loadStartTime: now };
    case "LOADING_COMPLETE":
      return { loadCompleteTime: now };
    case "EXIT":
      return { gateOutTime: now };
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

export interface TransitionInput {
  visitId: string;
  action: Exclude<VisitAction, "GATE_IN">;
  actorUserId: string;
  photo?: { buffer: Buffer; mimeType: string };
}

export function transitionVisit(input: TransitionInput): Promise<VehicleVisitRow> {
  return db.transaction(async (tx) => {
    const [visit] = await tx
      .select()
      .from(vehicleVisits)
      .where(eq(vehicleVisits.id, input.visitId))
      .for("update")
      .limit(1);

    if (!visit) throw new VisitNotFoundError(`Visit ${input.visitId} not found`);
    if (!canTransition(visit.currentStatus, input.action)) {
      throw new InvalidTransitionError(
        `Cannot ${input.action} a visit currently in status ${visit.currentStatus}`,
      );
    }

    const now = new Date();
    const nextStatus = nextStatusFor(input.action, visit.operationType);

    const [updated] = await tx
      .update(vehicleVisits)
      .set({ ...timeFieldFor(input.action, now), currentStatus: nextStatus, updatedAt: now })
      .where(eq(vehicleVisits.id, visit.id))
      .returning();
    if (!updated) throw new Error("Failed to update visit");

    let photoObjectKey: string | null = null;
    if (input.photo) {
      const kind: PhotoKind = "loaded-truck";
      photoObjectKey = await uploadPhoto(input.photo.buffer, input.photo.mimeType, visit.id, kind);
    }

    await tx.insert(visitEvents).values({
      visitId: visit.id,
      eventType: nextStatus,
      actorUserId: input.actorUserId,
      timestamp: now,
      photoObjectKey,
    });

    return updated;
  });
}
