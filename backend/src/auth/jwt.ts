import jwt from "jsonwebtoken";
import { jwtPayloadSchema, type JwtPayload } from "@beacon/shared";
import { env } from "../config/env";

export function signAccessToken(userId: string): string {
  const payload: JwtPayload = { sub: userId };
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as NonNullable<jwt.SignOptions["expiresIn"]>,
  });
}

export class InvalidTokenError extends Error {}

export function verifyAccessToken(token: string): JwtPayload {
  let decoded: string | jwt.JwtPayload;
  try {
    decoded = jwt.verify(token, env.JWT_SECRET);
  } catch {
    throw new InvalidTokenError("Token verification failed");
  }

  const result = jwtPayloadSchema.safeParse(decoded);
  if (!result.success) {
    throw new InvalidTokenError("Token payload has an unexpected shape");
  }
  return result.data;
}
