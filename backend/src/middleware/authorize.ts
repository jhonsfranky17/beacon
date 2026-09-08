import type { NextFunction, Request, Response } from "express";
import type { AuthUser, UserRole } from "@beacon/shared";

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Insufficient role" });
      return;
    }
    next();
  };
}

/**
 * CORPORATE_ADMIN (plantId === null) can access every plant; every other
 * role may only access its own plant. Callers must fetch the target
 * resource (and 404 if it doesn't exist) BEFORE calling this, so a
 * not-found resource never leaks its existence via a 403 instead of 404.
 */
export function canAccessPlant(user: AuthUser, targetPlantId: string): boolean {
  if (user.role === "CORPORATE_ADMIN") return true;
  return user.plantId === targetPlantId;
}
