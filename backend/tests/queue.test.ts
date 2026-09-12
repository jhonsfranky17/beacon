import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { db, pool } from "../src/db/client";
import { vehicleVisits } from "../src/db/schema";
import { redis } from "../src/redis";
import { resetDb, createOrgAndPlant, createUser, tinyPngBuffer } from "./helpers";

let app: Express;
let plantAId: string;
let plantBId: string;

const SECURITY_PHONE = "9200000001";
const PLANT_B_SECURITY_PHONE = "9200000002";
const PASSWORD = "test-password-1";

async function loginAndGetToken(phone: string): Promise<string> {
  const res = await request(app).post("/auth/login").send({ phone, password: PASSWORD });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${phone}: ${JSON.stringify(res.body)}`);
  }
  return res.body.token as string;
}

function nextVehicleNo(): string {
  return `TN${Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0")}`;
}

async function gateIn(token: string, vehicleNo: string, driverNo: string): Promise<string> {
  const res = await request(app)
    .post("/visits/gate-in")
    .set("Authorization", `Bearer ${token}`)
    .field("vehicleNo", vehicleNo)
    .field("driverNo", driverNo)
    .field("operationType", "OUTBOUND")
    .attach("photo", tinyPngBuffer(), "empty.png");
  if (res.status !== 200) {
    throw new Error(`gate-in failed: ${JSON.stringify(res.body)}`);
  }
  return res.body.visit.id as string;
}

describe("live queue", () => {
  let securityToken: string;
  let plantBSecurityToken: string;

  beforeEach(async () => {
    app = createApp();
    await resetDb();
    await redis.flushdb();

    const a = await createOrgAndPlant("QUEUE-A");
    const b = await createOrgAndPlant("QUEUE-B");
    plantAId = a.plantId;
    plantBId = b.plantId;

    await createUser({ role: "SECURITY", plantId: plantAId, phone: SECURITY_PHONE, password: PASSWORD });
    await createUser({
      role: "SECURITY",
      plantId: plantBId,
      phone: PLANT_B_SECURITY_PHONE,
      password: PASSWORD,
    });

    securityToken = await loginAndGetToken(SECURITY_PHONE);
    plantBSecurityToken = await loginAndGetToken(PLANT_B_SECURITY_PHONE);
  });

  afterAll(async () => {
    await pool.end();
    await redis.quit();
  });

  it("returns only this plant's non-EXITED visits, ordered by gate_in_time", async () => {
    const first = await gateIn(securityToken, nextVehicleNo(), "DL001");
    const second = await gateIn(securityToken, nextVehicleNo(), "DL002");

    // A visit at plant B must never appear in plant A's queue.
    await gateIn(plantBSecurityToken, nextVehicleNo(), "DLB01");

    // Mark the first visit EXITED directly (exit requires LOADED/UNLOADED
    // first, which isn't the point of this test) — it should drop out of
    // the live queue.
    await db.update(vehicleVisits).set({ currentStatus: "EXITED" }).where(eq(vehicleVisits.id, first));

    const res = await request(app)
      .get(`/plants/${plantAId}/queue`)
      .set("Authorization", `Bearer ${securityToken}`);

    expect(res.status).toBe(200);
    const ids = res.body.queue.map((v: { id: string }) => v.id);
    expect(ids).toEqual([second]);
  });

  it("orders visits by gate_in_time ascending", async () => {
    const later = await gateIn(securityToken, nextVehicleNo(), "DL010");
    const earlier = await gateIn(securityToken, nextVehicleNo(), "DL011");

    // Force `earlier` to have an actually earlier gate_in_time than `later`.
    await db
      .update(vehicleVisits)
      .set({ gateInTime: new Date(Date.now() - 60_000) })
      .where(eq(vehicleVisits.id, earlier));

    const res = await request(app)
      .get(`/plants/${plantAId}/queue`)
      .set("Authorization", `Bearer ${securityToken}`);

    const ids = res.body.queue.map((v: { id: string }) => v.id);
    expect(ids).toEqual([earlier, later]);
  });

  it("flags a visit as ageing once past the plant's threshold, and not before", async () => {
    const freshId = await gateIn(securityToken, nextVehicleNo(), "DL020");
    const oldId = await gateIn(securityToken, nextVehicleNo(), "DL021");

    await db
      .update(vehicleVisits)
      .set({ gateInTime: new Date(Date.now() - 13 * 60 * 60 * 1000) })
      .where(eq(vehicleVisits.id, oldId));

    const res = await request(app)
      .get(`/plants/${plantAId}/queue`)
      .set("Authorization", `Bearer ${securityToken}`);

    const byId = new Map(res.body.queue.map((v: { id: string; isAgeing: boolean }) => [v.id, v.isAgeing]));
    expect(byId.get(freshId)).toBe(false);
    expect(byId.get(oldId)).toBe(true);
  });

  it("blocks a cross-plant queue read", async () => {
    const res = await request(app)
      .get(`/plants/${plantAId}/queue`)
      .set("Authorization", `Bearer ${plantBSecurityToken}`);
    expect(res.status).toBe(403);
  });

  it("returns 404 for a plant that does not exist", async () => {
    const res = await request(app)
      .get("/plants/00000000-0000-0000-0000-000000000000/queue")
      .set("Authorization", `Bearer ${securityToken}`);
    expect(res.status).toBe(404);
  });
});
