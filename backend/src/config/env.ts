import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().min(1).default("12h"),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_ORIGIN: z.string().min(1).default("http://localhost:5173"),
  LOGIN_LOCKOUT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  BCRYPT_COST: z.coerce.number().int().min(10).max(15).default(12),
  SEED_ADMIN_PHONE: z.string().min(1).default("9999999999"),
  SEED_ADMIN_PASSWORD: z.string().min(8).default("changeme123"),
  MINIO_ENDPOINT: z.string().min(1).default("localhost"),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_USE_SSL: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  MINIO_ROOT_USER: z.string().min(1),
  MINIO_ROOT_PASSWORD: z.string().min(1),
  MINIO_BUCKET: z.string().min(1).default("beacon-photos"),
});

export const env = envSchema.parse(process.env);
