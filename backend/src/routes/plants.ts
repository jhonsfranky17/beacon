import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { plants } from "../db/schema";
import { authenticate } from "../middleware/authenticate";
import { canAccessPlant } from "../middleware/authorize";
import { asyncHandler } from "../middleware/asyncHandler";

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
