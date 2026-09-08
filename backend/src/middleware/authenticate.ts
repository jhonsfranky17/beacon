import { eq } from "drizzle-orm";
import type { AuthUser } from "@beacon/shared";
import { db } from "../db/client";
import { users } from "../db/schema";
import { InvalidTokenError, verifyAccessToken } from "../auth/jwt";
import { asyncHandler } from "./asyncHandler";

function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

export const authenticate = asyncHandler(async (req, res, next) => {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (error: unknown) {
    if (error instanceof InvalidTokenError) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
    throw error;
  }

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      plantId: users.plantId,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.id, payload.sub))
    .limit(1);
  const row = rows[0];

  if (!row || !row.isActive) {
    res.status(401).json({ error: "Account not found or inactive" });
    return;
  }

  const authUser: AuthUser = {
    id: row.id,
    name: row.name,
    role: row.role,
    plantId: row.plantId,
  };
  req.user = authUser;
  next();
});
