import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { VISIT_CHANGED_EVENT, type LiveVisitDto } from "@beacon/shared";
import { createApp } from "../src/app";
import { pool } from "../src/db/client";
import { redis } from "../src/redis";
import { initSocket } from "../src/realtime/socket";
import { setIoInstance, clearIoInstance } from "../src/realtime/broadcast";
import { resetDb, createOrgAndPlant, createUser, tinyPngBuffer } from "./helpers";

let httpServer: HttpServer;
let baseUrl: string;

const SECURITY_PHONE = "9300000001";
const PLANT_B_SECURITY_PHONE = "9300000002";
const ADMIN_PHONE = "9300000003";
const PASSWORD = "test-password-1";

async function loginAndGetToken(phone: string): Promise<string> {
  const res = await request(httpServer).post("/auth/login").send({ phone, password: PASSWORD });
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

function connectClient(token: string): ClientSocket {
  return ioClient(baseUrl, { auth: { token }, transports: ["websocket"], reconnection: false });
}

function connectClientNoAuth(): ClientSocket {
  return ioClient(baseUrl, { transports: ["websocket"], reconnection: false });
}

function waitForConnect(socket: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", (error: Error) => reject(error));
  });
}

function waitForVisitChanged(socket: ClientSocket, timeoutMs = 5000): Promise<LiveVisitDto> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for visit:changed")), timeoutMs);
    socket.once(VISIT_CHANGED_EVENT, (payload: LiveVisitDto) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe("realtime", () => {
  const sockets: ClientSocket[] = [];

  beforeAll(async () => {
    const app = createApp();
    httpServer = createServer(app);
    setIoInstance(initSocket(httpServer));
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const address = httpServer.address() as AddressInfo;
    baseUrl = `http://localhost:${address.port.toString()}`;
  });

  afterAll(async () => {
    clearIoInstance();
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => (error ? reject(error) : resolve()));
    });
    await pool.end();
    await redis.quit();
  });

  beforeEach(async () => {
    await resetDb();
    await redis.flushdb();

    const a = await createOrgAndPlant("RT-A");
    const b = await createOrgAndPlant("RT-B");

    await createUser({ role: "SECURITY", plantId: a.plantId, phone: SECURITY_PHONE, password: PASSWORD });
    await createUser({
      role: "SECURITY",
      plantId: b.plantId,
      phone: PLANT_B_SECURITY_PHONE,
      password: PASSWORD,
    });
    await createUser({ role: "CORPORATE_ADMIN", plantId: null, phone: ADMIN_PHONE, password: PASSWORD });
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) {
      socket.disconnect();
    }
  });

  it("broadcasts a gate-in to the visit's own plant room", async () => {
    const securityToken = await loginAndGetToken(SECURITY_PHONE);
    const plantASocket = connectClient(securityToken);
    sockets.push(plantASocket);
    await waitForConnect(plantASocket);

    const eventPromise = waitForVisitChanged(plantASocket);

    const gateInRes = await request(httpServer)
      .post("/visits/gate-in")
      .set("Authorization", `Bearer ${securityToken}`)
      .field("vehicleNo", nextVehicleNo())
      .field("driverNo", "DL001")
      .field("operationType", "OUTBOUND")
      .attach("photo", tinyPngBuffer(), "empty.png");
    expect(gateInRes.status).toBe(200);

    const payload = await eventPromise;
    expect(payload.id).toBe(gateInRes.body.visit.id);
    expect(payload.currentStatus).toBe("ARRIVED");
    expect(payload.isAgeing).toBe(false);
  });

  it("does not deliver a plant A broadcast to a plant B socket, but does to an admin socket", async () => {
    const securityToken = await loginAndGetToken(SECURITY_PHONE);
    const plantBToken = await loginAndGetToken(PLANT_B_SECURITY_PHONE);
    const adminToken = await loginAndGetToken(ADMIN_PHONE);

    const plantBSocket = connectClient(plantBToken);
    const adminSocket = connectClient(adminToken);
    sockets.push(plantBSocket, adminSocket);
    await Promise.all([waitForConnect(plantBSocket), waitForConnect(adminSocket)]);

    const receivedByB: unknown[] = [];
    plantBSocket.on(VISIT_CHANGED_EVENT, (payload: unknown) => receivedByB.push(payload));
    const adminEventPromise = waitForVisitChanged(adminSocket);

    const gateInRes = await request(httpServer)
      .post("/visits/gate-in")
      .set("Authorization", `Bearer ${securityToken}`)
      .field("vehicleNo", nextVehicleNo())
      .field("driverNo", "DL002")
      .field("operationType", "OUTBOUND")
      .attach("photo", tinyPngBuffer(), "empty.png");
    expect(gateInRes.status).toBe(200);

    const adminPayload = await adminEventPromise;
    expect(adminPayload.id).toBe(gateInRes.body.visit.id);

    // Give any stray delivery a moment before asserting plant B got nothing.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(receivedByB).toHaveLength(0);
  });

  it("refuses a connection with no token", async () => {
    const socket = connectClientNoAuth();
    sockets.push(socket);
    await expect(waitForConnect(socket)).rejects.toThrow();
  });

  it("refuses a connection with a garbage token", async () => {
    const socket = connectClient("garbage-token");
    sockets.push(socket);
    await expect(waitForConnect(socket)).rejects.toThrow();
  });
});
