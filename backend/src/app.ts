import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { pinoHttp } from "pino-http";
import { sql } from "drizzle-orm";
import { db } from "./db/client";
import { logger } from "./logger";
import { env } from "./config/env";
import { authRouter } from "./routes/auth";
import { plantsRouter } from "./routes/plants";
import { visitsRouter } from "./routes/visits";

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.FRONTEND_ORIGIN }));
  app.use(express.json());
  app.use(pinoHttp({ logger }));

  app.get("/health", (_req, res) => {
    db.execute(sql`select 1`)
      .then(() => res.status(200).json({ status: "ok", db: "connected" }))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "unknown error";
        res.status(503).json({ status: "error", db: "unreachable", error: message });
      });
  });

  const loginRateLimiter = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use("/auth/login", loginRateLimiter);

  app.use("/auth", authRouter);
  app.use("/plants", plantsRouter);
  app.use("/visits", visitsRouter);

  return app;
}
