import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/app";
import { pool } from "../src/db/client";
import { redis } from "../src/redis";
import { env } from "../src/config/env";
import { resetDb, createOrgAndPlant, createUser } from "./helpers";

const ADMIN_PHONE = "9000000001";
const ADMIN_PASSWORD = "correct-horse-battery";

describe("auth", () => {
  // Fresh app per test so express-rate-limit's in-memory store (and any
  // other per-process middleware state) never leaks between tests.
  let app: Express;

  beforeEach(async () => {
    app = createApp();
    await resetDb();
    await redis.flushdb();
    const { plantId } = await createOrgAndPlant("AUTH");
    await createUser({
      role: "LOGISTICS",
      plantId,
      phone: ADMIN_PHONE,
      password: ADMIN_PASSWORD,
      name: "Login Test User",
    });
  });

  afterAll(async () => {
    await pool.end();
    await redis.quit();
  });

  it("logs in with correct credentials and returns a usable token", async () => {
    const loginRes = await request(app)
      .post("/auth/login")
      .send({ phone: ADMIN_PHONE, password: ADMIN_PASSWORD });

    expect(loginRes.status).toBe(200);
    expect(typeof loginRes.body.token).toBe("string");
    expect(loginRes.body.user.role).toBe("LOGISTICS");

    const meRes = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${String(loginRes.body.token)}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.user.phone).toBeUndefined();
    expect(meRes.body.user.name).toBe("Login Test User");
  });

  it("rejects an unknown phone number", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ phone: "0000000000", password: "whatever12" });
    expect(res.status).toBe(401);
  });

  it("rejects a wrong password", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ phone: ADMIN_PHONE, password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("rejects a malformed request body", async () => {
    const res = await request(app).post("/auth/login").send({ phone: ADMIN_PHONE });
    expect(res.status).toBe(400);
  });

  it("rejects a request with no token", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
  });

  it("rejects a request with a garbage token", async () => {
    const res = await request(app).get("/auth/me").set("Authorization", "Bearer garbage");
    expect(res.status).toBe(401);
  });

  it("locks the account after too many failed attempts, even with the right password", async () => {
    for (let i = 0; i < env.LOGIN_LOCKOUT_MAX_ATTEMPTS; i++) {
      const res = await request(app)
        .post("/auth/login")
        .send({ phone: ADMIN_PHONE, password: "wrong-password" });
      expect(res.status).toBe(401);
    }

    const lockedRes = await request(app)
      .post("/auth/login")
      .send({ phone: ADMIN_PHONE, password: ADMIN_PASSWORD });
    expect(lockedRes.status).toBe(429);
  });

  it("resets the failed-attempt counter after a successful login", async () => {
    await request(app).post("/auth/login").send({ phone: ADMIN_PHONE, password: "wrong" });
    const res = await request(app)
      .post("/auth/login")
      .send({ phone: ADMIN_PHONE, password: ADMIN_PASSWORD });
    expect(res.status).toBe(200);
  });
});
