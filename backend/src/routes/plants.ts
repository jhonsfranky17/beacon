import { Router } from "express";
import { and, asc, eq, ne } from "drizzle-orm";
import type { LiveVisitDto } from "@beacon/shared";
import { db } from "../db/client";
import { plants, vehicles, vehicleVisits } from "../db/schema";
import { authenticate } from "../middleware/authenticate";
import { canAccessPlant } from "../middleware/authorize";
import { asyncHandler } from "../middleware/asyncHandler";
import { toVisitDto } from "../visits/visitService";
import { isAgeing } from "../visits/ageing";

export const plantsRouter = Router();

plantsRouter.use(authenticate);

plantsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    if (user.role === "CORPORATE_ADMIN") {
      const rows = await db.select().from(plants);
      res.status(200).json({ plants: rows });
      return;
    }

    if (!user.plantId) {
      res.status(200).json({ plants: [] });
      return;
    }

    const rows = await db.select().from(plants).where(eq(plants.id, user.plantId));
    res.status(200).json({ plants: rows });
  }),
);

plantsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: "Missing plant id" });
      return;
    }
    const rows = await db.select().from(plants).where(eq(plants.id, id)).limit(1);
    const plant = rows[0];

    if (!plant) {
      res.status(404).json({ error: "Plant not found" });
      return;
    }

    if (!canAccessPlant(user, plant.id)) {
      res.status(403).json({ error: "Not authorized for this plant" });
      return;
    }

    res.status(200).json({ plant });
  }),
);

plantsRouter.get(
  "/:id/queue",
  asyncHandler(async (req, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: "Missing plant id" });
      return;
    }
    const rows = await db.select().from(plants).where(eq(plants.id, id)).limit(1);
    const plant = rows[0];

    if (!plant) {
      res.status(404).json({ error: "Plant not found" });
      return;
    }
    if (!canAccessPlant(user, plant.id)) {
      res.status(403).json({ error: "Not authorized for this plant" });
      return;
    }

    // Every truck currently on-site or pre-registered but not yet arrived
    // (build-spec: "every truck at every plant, from gate-in to gate-out").
    const activeVisits = await db
      .select({ visit: vehicleVisits, vehicleNo: vehicles.vehicleNo })
      .from(vehicleVisits)
      .innerJoin(vehicles, eq(vehicleVisits.vehicleId, vehicles.id))
      .where(and(eq(vehicleVisits.plantId, plant.id), ne(vehicleVisits.currentStatus, "EXITED")))
      .orderBy(asc(vehicleVisits.gateInTime));

    const queue: LiveVisitDto[] = activeVisits.map(({ visit, vehicleNo }) => ({
      ...toVisitDto(visit, vehicleNo),
      isAgeing: isAgeing(visit.gateInTime, visit.currentStatus, plant.ageingThresholdHours),
    }));

    res.status(200).json({ queue });
  }),
);
