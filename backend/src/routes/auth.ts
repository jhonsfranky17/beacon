import { Router } from "express";
import { eq } from "drizzle-orm";
import { loginRequestSchema, type AuthUser, type LoginResponse } from "@beacon/shared";
import { db } from "../db/client";
import { users } from "../db/schema";
import { verifyPassword } from "../auth/password";
import { signAccessToken } from "../auth/jwt";
import { isLocked, recordFailedAttempt, resetAttempts } from "../auth/loginAttempts";
import { authenticate } from "../middleware/authenticate";
import { asyncHandler } from "../middleware/asyncHandler";
import { env } from "../config/env";

export const authRouter = Router();

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const parsed = loginRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      return;
    }
    const { phone, password } = parsed.data;

    if (await isLocked(phone)) {
      res.status(429).json({
        error: `Account locked after too many failed attempts. Try again in ${String(
          env.LOGIN_LOCKOUT_WINDOW_MINUTES,
        )} minutes.`,
      });
      return;
    }

    const rows = await db
      .select()
      .from(users)
      .where(eq(users.phone, phone))
      .limit(1);
    const user = rows[0];

    if (!user || !user.isActive) {
      await recordFailedAttempt(phone);
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const passwordOk = await verifyPassword(password, user.passwordHash);
    if (!passwordOk) {
      await recordFailedAttempt(phone);
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    await resetAttempts(phone);
    const token = signAccessToken(user.id);
    const authUser: AuthUser = {
      id: user.id,
      name: user.name,
      role: user.role,
      plantId: user.plantId,
    };
    const body: LoginResponse = { token, user: authUser };
    res.status(200).json(body);
  }),
);

authRouter.get("/me", authenticate, (req, res) => {
  res.status(200).json({ user: req.user });
});
