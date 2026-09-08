import { redis } from "../redis";
import { env } from "../config/env";

function attemptsKey(phone: string): string {
  return `login:fail:${phone}`;
}

export async function isLocked(phone: string): Promise<boolean> {
  const attempts = await redis.get(attemptsKey(phone));
  return attempts !== null && Number(attempts) >= env.LOGIN_LOCKOUT_MAX_ATTEMPTS;
}

export async function recordFailedAttempt(phone: string): Promise<void> {
  const key = attemptsKey(phone);
  const attempts = await redis.incr(key);
  if (attempts === 1) {
    await redis.expire(key, env.LOGIN_LOCKOUT_WINDOW_MINUTES * 60);
  }
}

export async function resetAttempts(phone: string): Promise<void> {
  await redis.del(attemptsKey(phone));
}
