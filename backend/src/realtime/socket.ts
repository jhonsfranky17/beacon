import type { Server as HttpServer } from "node:http";
import { Server, type DefaultEventsMap } from "socket.io";
import type { AuthUser } from "@beacon/shared";
import { resolveAuthUser } from "../auth/resolveUser";
import { env } from "../config/env";
import { ADMIN_ROOM, plantRoom } from "./rooms";

export interface SocketData {
  user: AuthUser;
}

export type AppSocketServer = Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

/**
 * Same JWT-then-DB-lookup rule as the REST `authenticate` middleware
 * (via resolveAuthUser) — a socket with no/invalid/expired/inactive-user
 * token is refused at handshake, before "connection" ever fires.
 */
export function initSocket(httpServer: HttpServer): AppSocketServer {
  const io: AppSocketServer = new Server(httpServer, {
    cors: { origin: env.FRONTEND_ORIGIN },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (typeof token !== "string") {
      next(new Error("Missing auth token"));
      return;
    }

    resolveAuthUser(token).then(
      (user) => {
        if (!user) {
          next(new Error("Invalid, expired, or inactive account token"));
          return;
        }
        socket.data.user = user;
        next();
      },
      (error: unknown) => {
        next(error instanceof Error ? error : new Error("Authentication failed"));
      },
    );
  });

  // Room-based plant scoping, mirroring the REST layer's canAccessPlant:
  // non-admins only ever see their own plant's updates; CORPORATE_ADMIN
  // sees everything via the fixed admin room.
  io.on("connection", (socket) => {
    const { user } = socket.data;
    if (user.role === "CORPORATE_ADMIN") {
      void socket.join(ADMIN_ROOM);
    } else if (user.plantId) {
      void socket.join(plantRoom(user.plantId));
    }
  });

  return io;
}
