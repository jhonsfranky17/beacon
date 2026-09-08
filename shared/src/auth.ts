import { z } from "zod";
import { userRoleSchema } from "./roles.js";

/** POST /auth/login request body. */
export const loginRequestSchema = z.object({
  phone: z.string().min(1),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/**
 * The user shape returned to clients — never includes passwordHash.
 * plantId is null only for CORPORATE_ADMIN (build-spec §4/§6).
 */
export const authUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  role: userRoleSchema,
  plantId: z.string().uuid().nullable(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const loginResponseSchema = z.object({
  token: z.string(),
  user: authUserSchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

/**
 * Shape of our own JWT payload after decoding — validated at runtime since
 * jsonwebtoken hands back `unknown`/`JwtPayload | string`, never trusted
 * as-is (CLAUDE.md: never use `unknown` without an immediate, exhaustive
 * narrowing check).
 */
export const jwtPayloadSchema = z.object({
  sub: z.string().uuid(),
});
export type JwtPayload = z.infer<typeof jwtPayloadSchema>;
