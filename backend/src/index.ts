import express, { type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "./db/client";

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.get("/health", async (_req: Request, res: Response) => {
  try {
    await db.execute(sql`select 1`);
    res.status(200).json({ status: "ok", db: "connected" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    res.status(503).json({ status: "error", db: "unreachable", error: message });
  }
});

app.listen(port, () => {
  console.log(`Beacon backend listening on port ${port}`);
});
