import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { db, pool } from "../src/db/client";
import { vehicles, vehicleVisits, visitEvents } from "../src/db/schema";
import { redis } from "../src/redis";
import { resetDb, createOrgAndPlant, createUser, tinyPngBuffer } from "./helpers";

let app: Express;
let plantAId: string;
let plantBId: string;

const SECURITY_PHONE = "9100000001";
const LOGISTICS_PHONE = "9100000002";
const LOADING_OP_PHONE = "9100000003";
const PLANT_B_SECURITY_PHONE = "9100000004";
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

async function visitRowCount(vehicleNo: string, plantId: string): Promise<number> {
  const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.vehicleNo, vehicleNo)).limit(1);
  if (!vehicle) return 0;
  const rows = await db
    .select()
    .from(vehicleVisits)
    .where(eq(vehicleVisits.vehicleId, vehicle.id));
  return rows.filter((r) => r.plantId === plantId).length;
}

describe("visits", () => {
  let securityToken: string;
  let logisticsToken: string;
  let loadingOpToken: string;
  let plantBSecurityToken: string;

  beforeEach(async () => {
    app = createApp();
    await resetDb();
    await redis.flushdb();

    const a = await createOrgAndPlant("VISIT-A");
    const b = await createOrgAndPlant("VISIT-B");
    plantAId = a.plantId;
    plantBId = b.plantId;

    await createUser({ role: "SECURITY", plantId: plantAId, phone: SECURITY_PHONE, password: PASSWORD });
    await createUser({ role: "LOGISTICS", plantId: plantAId, phone: LOGISTICS_PHONE, password: PASSWORD });
    await createUser({
      role: "LOADING_OPERATOR",
      plantId: plantAId,
      phone: LOADING_OP_PHONE,
      password: PASSWORD,
    });
    await createUser({
      role: "SECURITY",
      plantId: plantBId,
      phone: PLANT_B_SECURITY_PHONE,
      password: PASSWORD,
    });

    securityToken = await loginAndGetToken(SECURITY_PHONE);
    logisticsToken = await loginAndGetToken(LOGISTICS_PHONE);
    loadingOpToken = await loginAndGetToken(LOADING_OP_PHONE);
    plantBSecurityToken = await loginAndGetToken(PLANT_B_SECURITY_PHONE);
  });

  afterAll(async () => {
    await pool.end();
    await redis.quit();
  });

  describe("gate-in", () => {
    it("creates a new visit at ARRIVED with a photo", async () => {
      const vehicleNo = nextVehicleNo();
      const res = await request(app)
        .post("/visits/gate-in")
        .set("Authorization", `Bearer ${securityToken}`)
        .field("vehicleNo", vehicleNo)
        .field("driverNo", "DL123")
        .field("operationType", "OUTBOUND")
        .attach("photo", tinyPngBuffer(), "empty.png");

      expect(res.status).toBe(200);
      expect(res.body.visit.currentStatus).toBe("ARRIVED");
      expect(res.body.visit.gateInTime).not.toBeNull();
      expect(res.body.visit.plantId).toBe(plantAId);
    });

    it("rejects gate-in with no photo", async () => {
      const res = await request(app)
        .post("/visits/gate-in")
        .set("Authorization", `Bearer ${securityToken}`)
        .field("vehicleNo", nextVehicleNo())
        .field("driverNo", "DL123")
        .field("operationType", "OUTBOUND");

      expect(res.status).toBe(400);
    });

    it("rejects gate-in from a non-SECURITY role", async () => {
      const res = await request(app)
        .post("/visits/gate-in")
        .set("Authorization", `Bearer ${logisticsToken}`)
        .field("vehicleNo", nextVehicleNo())
        .field("driverNo", "DL123")
        .field("operationType", "OUTBOUND")
        .attach("photo", tinyPngBuffer(), "empty.png");

      expect(res.status).toBe(403);
    });
  });

  describe("reconciliation", () => {
    it("merges a later gate-in into an earlier pre-registration (one row)", async () => {
      const vehicleNo = nextVehicleNo();

      const preRegRes = await request(app)
        .post("/visits/pre-register")
        .set("Authorization", `Bearer ${logisticsToken}`)
        .send({ vehicleNo, customer: "Acme Corp", location: "Dock 3", operationType: "OUTBOUND" });
      expect(preRegRes.status).toBe(200);
      expect(preRegRes.body.visit.currentStatus).toBe("NEEDS_TAGGING");

      const gateInRes = await request(app)
        .post("/visits/gate-in")
        .set("Authorization", `Bearer ${securityToken}`)
        .field("vehicleNo", vehicleNo)
        .field("driverNo", "DL999")
        .field("operationType", "OUTBOUND")
        .attach("photo", tinyPngBuffer(), "empty.png");
      expect(gateInRes.status).toBe(200);
      expect(gateInRes.body.visit.id).toBe(preRegRes.body.visit.id);
      expect(gateInRes.body.visit.currentStatus).toBe("ARRIVED");
      expect(gateInRes.body.visit.customer).toBe("Acme Corp");
      expect(gateInRes.body.visit.location).toBe("Dock 3");

      expect(await visitRowCount(vehicleNo, plantAId)).toBe(1);
    });

    it("merges an earlier gate-in with a later pre-registration (one row)", async () => {
      const vehicleNo = nextVehicleNo();

      const gateInRes = await request(app)
        .post("/visits/gate-in")
        .set("Authorization", `Bearer ${securityToken}`)
        .field("vehicleNo", vehicleNo)
        .field("driverNo", "DL999")
        .field("operationType", "INBOUND")
        .attach("photo", tinyPngBuffer(), "empty.png");
      expect(gateInRes.status).toBe(200);

      const preRegRes = await request(app)
        .post("/visits/pre-register")
        .set("Authorization", `Bearer ${logisticsToken}`)
        .send({ vehicleNo, customer: "Beta Ltd", location: "Dock 1", operationType: "INBOUND" });
      expect(preRegRes.status).toBe(200);
      expect(preRegRes.body.visit.id).toBe(gateInRes.body.visit.id);
      expect(preRegRes.body.visit.currentStatus).toBe("ARRIVED");

      expect(await visitRowCount(vehicleNo, plantAId)).toBe(1);
    });

    it("merges two concurrent submissions (pre-register and gate-in) into exactly one row", async () => {
      const vehicleNo = nextVehicleNo();

      const [preRegRes, gateInRes] = await Promise.all([
        request(app)
          .post("/visits/pre-register")
          .set("Authorization", `Bearer ${logisticsToken}`)
          .send({ vehicleNo, customer: "Race Corp", location: "Dock 9", operationType: "OUTBOUND" }),
        request(app)
          .post("/visits/gate-in")
          .set("Authorization", `Bearer ${securityToken}`)
          .field("vehicleNo", vehicleNo)
          .field("driverNo", "DL777")
          .field("operationType", "OUTBOUND")
          .attach("photo", tinyPngBuffer(), "empty.png"),
      ]);

      expect(preRegRes.status).toBe(200);
      expect(gateInRes.status).toBe(200);
      expect(await visitRowCount(vehicleNo, plantAId)).toBe(1);

      const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.vehicleNo, vehicleNo)).limit(1);
      expect(vehicle).toBeDefined();
      const [visit] = await db
        .select()
        .from(vehicleVisits)
        .where(eq(vehicleVisits.vehicleId, vehicle!.id))
        .limit(1);
      expect(visit?.currentStatus).toBe("ARRIVED");
      expect(visit?.customer).toBe("Race Corp");
      expect(visit?.driverNo).toBe("DL777");
    });
  });

  describe("full lifecycle", () => {
    it("walks an OUTBOUND visit through gate-in -> loading-start -> loading-complete -> exit", async () => {
      const vehicleNo = nextVehicleNo();

      const gateIn = await request(app)
        .post("/visits/gate-in")
        .set("Authorization", `Bearer ${securityToken}`)
        .field("vehicleNo", vehicleNo)
        .field("driverNo", "DL001")
        .field("operationType", "OUTBOUND")
        .attach("photo", tinyPngBuffer(), "empty.png");
      expect(gateIn.status).toBe(200);
      const visitId = gateIn.body.visit.id as string;

      const start = await request(app)
        .post(`/visits/${visitId}/loading-start`)
        .set("Authorization", `Bearer ${loadingOpToken}`)
        .send({});
      expect(start.status).toBe(200);
      expect(start.body.visit.currentStatus).toBe("LOADING");
      expect(start.body.visit.loadStartTime).not.toBeNull();

      const complete = await request(app)
        .post(`/visits/${visitId}/loading-complete`)
        .set("Authorization", `Bearer ${loadingOpToken}`)
        .attach("photo", tinyPngBuffer(), "loaded.png");
      expect(complete.status).toBe(200);
      expect(complete.body.visit.currentStatus).toBe("LOADED");
      expect(complete.body.visit.loadCompleteTime).not.toBeNull();

      const exit = await request(app)
        .post(`/visits/${visitId}/exit`)
        .set("Authorization", `Bearer ${securityToken}`)
        .send({});
      expect(exit.status).toBe(200);
      expect(exit.body.visit.currentStatus).toBe("EXITED");
      expect(exit.body.visit.gateOutTime).not.toBeNull();

      const events = await db.select().from(visitEvents).where(eq(visitEvents.visitId, visitId));
      expect(events).toHaveLength(4);
      expect(events.map((e) => e.eventType).sort()).toEqual(
        ["ARRIVED", "EXITED", "LOADED", "LOADING"].sort(),
      );
    });

    it("walks an INBOUND visit through gate-in -> loading-start -> loading-complete -> exit using UNLOADING/UNLOADED", async () => {
      const vehicleNo = nextVehicleNo();

      const gateIn = await request(app)
        .post("/visits/gate-in")
        .set("Authorization", `Bearer ${securityToken}`)
        .field("vehicleNo", vehicleNo)
        .field("driverNo", "DL002")
        .field("operationType", "INBOUND")
        .attach("photo", tinyPngBuffer(), "empty.png");
      const visitId = gateIn.body.visit.id as string;

      const start = await request(app)
        .post(`/visits/${visitId}/loading-start`)
        .set("Authorization", `Bearer ${loadingOpToken}`)
        .send({});
      expect(start.body.visit.currentStatus).toBe("UNLOADING");

      const complete = await request(app)
        .post(`/visits/${visitId}/loading-complete`)
        .set("Authorization", `Bearer ${loadingOpToken}`)
        .attach("photo", tinyPngBuffer(), "loaded.png");
      expect(complete.body.visit.currentStatus).toBe("UNLOADED");

      const exit = await request(app)
        .post(`/visits/${visitId}/exit`)
        .set("Authorization", `Bearer ${securityToken}`)
        .send({});
      expect(exit.body.visit.currentStatus).toBe("EXITED");
    });

    it("rejects loading-complete with no photo", async () => {
      const vehicleNo = nextVehicleNo();
      const gateIn = await request(app)
        .post("/visits/gate-in")
        .set("Authorization", `Bearer ${securityToken}`)
        .field("vehicleNo", vehicleNo)
        .field("driverNo", "DL003")
        .field("operationType", "OUTBOUND")
        .attach("photo", tinyPngBuffer(), "empty.png");
      const visitId = gateIn.body.visit.id as string;

      await request(app)
        .post(`/visits/${visitId}/loading-start`)
        .set("Authorization", `Bearer ${loadingOpToken}`)
        .send({});

      const complete = await request(app)
        .post(`/visits/${visitId}/loading-complete`)
        .set("Authorization", `Bearer ${loadingOpToken}`);
      expect(complete.status).toBe(400);
    });

    it("rejects exit from a visit that hasn't finished loading", async () => {
      const vehicleNo = nextVehicleNo();
      const gateIn = await request(app)
        .post("/visits/gate-in")
        .set("Authorization", `Bearer ${securityToken}`)
        .field("vehicleNo", vehicleNo)
        .field("driverNo", "DL004")
        .field("operationType", "OUTBOUND")
        .attach("photo", tinyPngBuffer(), "empty.png");
      const visitId = gateIn.body.visit.id as string;

      const exit = await request(app)
        .post(`/visits/${visitId}/exit`)
        .set("Authorization", `Bearer ${securityToken}`)
        .send({});
      expect(exit.status).toBe(409);
    });

    it("rejects loading-start on a visit that's already loading", async () => {
      const vehicleNo = nextVehicleNo();
      const gateIn = await request(app)
        .post("/visits/gate-in")
        .set("Authorization", `Bearer ${securityToken}`)
        .field("vehicleNo", vehicleNo)
        .field("driverNo", "DL005")
        .field("operationType", "OUTBOUND")
        .attach("photo", tinyPngBuffer(), "empty.png");
      const visitId = gateIn.body.visit.id as string;

      await request(app)
        .post(`/visits/${visitId}/loading-start`)
        .set("Authorization", `Bearer ${loadingOpToken}`)
        .send({});

      const secondStart = await request(app)
        .post(`/visits/${visitId}/loading-start`)
        .set("Authorization", `Bearer ${loadingOpToken}`)
        .send({});
      expect(secondStart.status).toBe(409);
    });
  });

  describe("reads", () => {
    it("returns the visit and its event history for the visit's own plant", async () => {
      const vehicleNo = nextVehicleNo();
      const gateIn = await request(app)
        .post("/visits/gate-in")
        .set("Authorization", `Bearer ${securityToken}`)
        .field("vehicleNo", vehicleNo)
        .field("driverNo", "DL006")
        .field("operationType", "OUTBOUND")
        .attach("photo", tinyPngBuffer(), "empty.png");
      const visitId = gateIn.body.visit.id as string;

      const res = await request(app)
        .get(`/visits/${visitId}`)
        .set("Authorization", `Bearer ${securityToken}`);
      expect(res.status).toBe(200);
      expect(res.body.visit.id).toBe(visitId);
      expect(res.body.events).toHaveLength(1);
      expect(res.body.events[0].eventType).toBe("ARRIVED");
      expect(res.body.events[0].photoObjectKey).not.toBeNull();
    });

    it("blocks a cross-plant read of a visit", async () => {
      const vehicleNo = nextVehicleNo();
      const gateIn = await request(app)
        .post("/visits/gate-in")
        .set("Authorization", `Bearer ${securityToken}`)
        .field("vehicleNo", vehicleNo)
        .field("driverNo", "DL007")
        .field("operationType", "OUTBOUND")
        .attach("photo", tinyPngBuffer(), "empty.png");
      const visitId = gateIn.body.visit.id as string;

      const res = await request(app)
        .get(`/visits/${visitId}`)
        .set("Authorization", `Bearer ${plantBSecurityToken}`);
      expect(res.status).toBe(403);
    });

    it("returns 404 for a visit that does not exist", async () => {
      const res = await request(app)
        .get("/visits/00000000-0000-0000-0000-000000000000")
        .set("Authorization", `Bearer ${securityToken}`);
      expect(res.status).toBe(404);
    });

    it("redirects to a signed photo URL for the visit's own plant", async () => {
      const vehicleNo = nextVehicleNo();
      const gateIn = await request(app)
        .post("/visits/gate-in")
        .set("Authorization", `Bearer ${securityToken}`)
        .field("vehicleNo", vehicleNo)
        .field("driverNo", "DL008")
        .field("operationType", "OUTBOUND")
        .attach("photo", tinyPngBuffer(), "empty.png");
      const visitId = gateIn.body.visit.id as string;

      const detail = await request(app)
        .get(`/visits/${visitId}`)
        .set("Authorization", `Bearer ${securityToken}`);
      const eventId = detail.body.events[0].id as string;

      const photoRes = await request(app)
        .get(`/visits/${visitId}/photos/${eventId}`)
        .set("Authorization", `Bearer ${securityToken}`)
        .redirects(0);
      expect(photoRes.status).toBe(302);
      expect(photoRes.headers.location).toContain("beacon-test");
    });

    it("blocks a cross-plant photo fetch", async () => {
      const vehicleNo = nextVehicleNo();
      const gateIn = await request(app)
        .post("/visits/gate-in")
        .set("Authorization", `Bearer ${securityToken}`)
        .field("vehicleNo", vehicleNo)
        .field("driverNo", "DL009")
        .field("operationType", "OUTBOUND")
        .attach("photo", tinyPngBuffer(), "empty.png");
      const visitId = gateIn.body.visit.id as string;

      const detail = await request(app)
        .get(`/visits/${visitId}`)
        .set("Authorization", `Bearer ${securityToken}`);
      const eventId = detail.body.events[0].id as string;

      const photoRes = await request(app)
        .get(`/visits/${visitId}/photos/${eventId}`)
        .set("Authorization", `Bearer ${plantBSecurityToken}`)
        .redirects(0);
      expect(photoRes.status).toBe(403);
    });
  });
});
