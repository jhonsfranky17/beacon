import { Router, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import {
  gateInRequestSchema,
  preRegisterRequestSchema,
  normalizeVehicleNo,
  type AuthUser,
  type VisitEventDto,
} from "@beacon/shared";
import { db } from "../db/client";
import { plants, visitEvents } from "../db/schema";
import { authenticate } from "../middleware/authenticate";
import { requireRole, canAccessPlant } from "../middleware/authorize";
import { asyncHandler } from "../middleware/asyncHandler";
import { singlePhotoUpload } from "../middleware/upload";
import { getPhotoSignedUrl } from "../storage/photos";
import { broadcastVisitUpdate } from "../realtime/broadcast";
import type { VisitAction } from "../visits/stateMachine";
import {
  getVisitById,
  toVisitDto,
  upsertVisitForGateIn,
  upsertVisitForPreRegistration,
  transitionVisit,
  InvalidTransitionError,
  VisitNotFoundError,
  type VehicleVisitRow,
} from "../visits/visitService";

/** Broadcasts the post-write visit state to everyone watching its plant. */
async function broadcastVisit(visit: VehicleVisitRow, vehicleNo: string): Promise<void> {
  const [plant] = await db
    .select({ ageingThresholdHours: plants.ageingThresholdHours })
    .from(plants)
    .where(eq(plants.id, visit.plantId))
    .limit(1);
  broadcastVisitUpdate(visit, vehicleNo, plant?.ageingThresholdHours ?? 12);
}

export const visitsRouter = Router();

visitsRouter.use(authenticate);

/** SECURITY/LOGISTICS/LOADING_OPERATOR always have a plantId; only CORPORATE_ADMIN doesn't. */
function requirePlantId(user: AuthUser, res: Response): string | null {
  if (!user.plantId) {
    res.status(403).json({ error: "This role has no assigned plant" });
    return null;
  }
  return user.plantId;
}

function toVisitEventDto(row: typeof visitEvents.$inferSelect): VisitEventDto {
  return {
    id: row.id,
    eventType: row.eventType,
    actorUserId: row.actorUserId,
    timestamp: row.timestamp.toISOString(),
    photoObjectKey: row.photoObjectKey,
    metadata: row.metadata,
  };
}

visitsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: "Missing visit id" });
      return;
    }

    const result = await getVisitById(id);
    if (!result) {
      res.status(404).json({ error: "Visit not found" });
      return;
    }
    if (!canAccessPlant(user, result.visit.plantId)) {
      res.status(403).json({ error: "Not authorized for this plant" });
      return;
    }

    const events = await db
      .select()
      .from(visitEvents)
      .where(eq(visitEvents.visitId, id))
      .orderBy(visitEvents.timestamp);

    res.status(200).json({
      visit: toVisitDto(result.visit, result.vehicleNo),
      events: events.map(toVisitEventDto),
    });
  }),
);

visitsRouter.get(
  "/:id/photos/:eventId",
  asyncHandler(async (req, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const { id, eventId } = req.params;
    if (!id || !eventId) {
      res.status(400).json({ error: "Missing id" });
      return;
    }

    const result = await getVisitById(id);
    if (!result) {
      res.status(404).json({ error: "Visit not found" });
      return;
    }
    if (!canAccessPlant(user, result.visit.plantId)) {
      res.status(403).json({ error: "Not authorized for this plant" });
      return;
    }

    const [event] = await db
      .select()
      .from(visitEvents)
      .where(and(eq(visitEvents.id, eventId), eq(visitEvents.visitId, id)))
      .limit(1);

    if (!event || !event.photoObjectKey) {
      res.status(404).json({ error: "Photo not found" });
      return;
    }

    const url = await getPhotoSignedUrl(event.photoObjectKey);
    res.redirect(302, url);
  }),
);

visitsRouter.post(
  "/gate-in",
  requireRole("SECURITY"),
  singlePhotoUpload("photo"),
  asyncHandler(async (req, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const plantId = requirePlantId(user, res);
    if (!plantId) return;

    const parsed = gateInRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "An empty-truck photo is required" });
      return;
    }

    try {
      const visit = await upsertVisitForGateIn({
        vehicleNo: parsed.data.vehicleNo,
        driverNo: parsed.data.driverNo,
        operationType: parsed.data.operationType,
        plantId,
        actorUserId: user.id,
        photo: { buffer: req.file.buffer, mimeType: req.file.mimetype },
      });
      const vehicleNo = normalizeVehicleNo(parsed.data.vehicleNo);
      await broadcastVisit(visit, vehicleNo);
      res.status(200).json({ visit: toVisitDto(visit, vehicleNo) });
    } catch (error: unknown) {
      if (error instanceof InvalidTransitionError) {
        res.status(409).json({ error: error.message });
        return;
      }
      throw error;
    }
  }),
);

visitsRouter.post(
  "/pre-register",
  requireRole("LOGISTICS"),
  asyncHandler(async (req, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const plantId = requirePlantId(user, res);
    if (!plantId) return;

    const parsed = preRegisterRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      return;
    }

    const visit = await upsertVisitForPreRegistration({
      vehicleNo: parsed.data.vehicleNo,
      customer: parsed.data.customer,
      location: parsed.data.location,
      operationType: parsed.data.operationType,
      plantId,
      actorUserId: user.id,
    });
    const vehicleNo = normalizeVehicleNo(parsed.data.vehicleNo);
    await broadcastVisit(visit, vehicleNo);
    res.status(200).json({ visit: toVisitDto(visit, vehicleNo) });
  }),
);

async function handleTransition(
  req: Request,
  res: Response,
  action: Exclude<VisitAction, "GATE_IN">,
  photoRequired: boolean,
): Promise<void> {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: "Missing visit id" });
    return;
  }

  const existing = await getVisitById(id);
  if (!existing) {
    res.status(404).json({ error: "Visit not found" });
    return;
  }
  if (!canAccessPlant(user, existing.visit.plantId)) {
    res.status(403).json({ error: "Not authorized for this plant" });
    return;
  }

  if (photoRequired && !req.file) {
    res.status(400).json({ error: "A loaded-truck photo is required" });
    return;
  }

  try {
    const visit = await transitionVisit({
      visitId: id,
      action,
      actorUserId: user.id,
      ...(req.file ? { photo: { buffer: req.file.buffer, mimeType: req.file.mimetype } } : {}),
    });
    await broadcastVisit(visit, existing.vehicleNo);
    res.status(200).json({ visit: toVisitDto(visit, existing.vehicleNo) });
  } catch (error: unknown) {
    if (error instanceof InvalidTransitionError) {
      res.status(409).json({ error: error.message });
      return;
    }
    if (error instanceof VisitNotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    throw error;
  }
}

visitsRouter.post(
  "/:id/loading-start",
  requireRole("LOADING_OPERATOR"),
  asyncHandler((req, res) => handleTransition(req, res, "LOADING_START", false)),
);

visitsRouter.post(
  "/:id/loading-complete",
  requireRole("LOADING_OPERATOR"),
  singlePhotoUpload("photo"),
  asyncHandler((req, res) => handleTransition(req, res, "LOADING_COMPLETE", true)),
);

visitsRouter.post(
  "/:id/exit",
  requireRole("SECURITY"),
  asyncHandler((req, res) => handleTransition(req, res, "EXIT", false)),
);
