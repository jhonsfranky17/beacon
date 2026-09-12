import { eq } from "drizzle-orm";
import type { AuthUser } from "@beacon/shared";
import { db } from "../db/client";
import { users } from "../db/schema";
import { InvalidTokenError, verifyAccessToken } from "./jwt";

/**
 * The single "what makes a token valid" check, shared by both the REST
 * `authenticate` middleware and the Socket.IO auth middleware — one place
 * to define it so the two transports can never drift. Returns null for any
 * failure (bad/expired token, user gone, deactivated); the caller decides
 * how to respond (401 for HTTP, connection refusal for a socket).
 */
export async function resolveAuthUser(token: string): Promise<AuthUser | null> {
  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (error: unknown) {
    if (error instanceof InvalidTokenError) return null;
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

  if (!row || !row.isActive) return null;

  return {
    id: row.id,
    name: row.name,
    role: row.role,
    plantId: row.plantId,
  };
}
