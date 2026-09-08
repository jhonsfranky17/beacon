import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/app";
import { pool } from "../src/db/client";
import { redis } from "../src/redis";
import { resetDb, createOrgAndPlant, createUser } from "./helpers";

const OPERATOR_PHONE = "9000000010";
const OPERATOR_PASSWORD = "operator-password-1";
const ADMIN_PHONE = "9000000011";
const ADMIN_PASSWORD = "admin-password-1";

let app: Express;
let plantAId: string;
let plantBId: string;

async function loginAndGetToken(phone: string, password: string): Promise<string> {
  const res = await request(app).post("/auth/login").send({ phone, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${phone}: ${JSON.stringify(res.body)}`);
  }
  return res.body.token as string;
}

describe("plant scoping", () => {
  beforeEach(async () => {
    app = createApp();
    await resetDb();
    await redis.flushdb();

    const a = await createOrgAndPlant("PLANT-A");
    const b = await createOrgAndPlant("PLANT-B");
    plantAId = a.plantId;
    plantBId = b.plantId;

    await createUser({
      role: "LOADING_OPERATOR",
      plantId: plantAId,
      phone: OPERATOR_PHONE,
      password: OPERATOR_PASSWORD,
    });
    await createUser({
      role: "CORPORATE_ADMIN",
      plantId: null,
      phone: ADMIN_PHONE,
      password: ADMIN_PASSWORD,
    });
  });

  afterAll(async () => {
    await pool.end();
    await redis.quit();
  });

  it("lets a plant-scoped user read their own plant", async () => {
    const token = await loginAndGetToken(OPERATOR_PHONE, OPERATOR_PASSWORD);
    const res = await request(app).get(`/plants/${plantAId}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.plant.id).toBe(plantAId);
  });

  it("blocks a plant-scoped user from reading another plant directly via the API, even though the UI would never construct this request", async () => {
    const token = await loginAndGetToken(OPERATOR_PHONE, OPERATOR_PASSWORD);
    const res = await request(app).get(`/plants/${plantBId}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("only lists the user's own plant in the collection endpoint", async () => {
    const token = await loginAndGetToken(OPERATOR_PHONE, OPERATOR_PASSWORD);
    const res = await request(app).get("/plants").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.plants).toHaveLength(1);
    expect(res.body.plants[0].id).toBe(plantAId);
  });

  it("lets CORPORATE_ADMIN read any plant", async () => {
    const token = await loginAndGetToken(ADMIN_PHONE, ADMIN_PASSWORD);
    const resA = await request(app).get(`/plants/${plantAId}`).set("Authorization", `Bearer ${token}`);
    const resB = await request(app).get(`/plants/${plantBId}`).set("Authorization", `Bearer ${token}`);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
  });

  it("returns 404, not 403, for a plant that does not exist at all", async () => {
    const token = await loginAndGetToken(OPERATOR_PHONE, OPERATOR_PASSWORD);
    const res = await request(app)
      .get("/plants/00000000-0000-0000-0000-000000000000")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
