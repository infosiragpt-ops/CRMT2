import { Server as IOServer } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { sessionMiddleware } from "./auth";
import { waManager } from "./wa-manager";
import { logger } from "./logger";
import { findDeviceBySessionForUser } from "./chats";
import { isConfiguredOrLocalOrigin, isTrustedOrigin } from "./http-security";
import { onInternalMessage } from "./internal-message-events";
import { markUserOffline, markUserOnline } from "./presence";

export function attachSocket(server: HttpServer): IOServer {
  const io = new IOServer(server, {
    path: "/socket.io",
    cors: {
      origin: (origin, cb) => {
        cb(null, !origin || isConfiguredOrLocalOrigin(origin));
      },
      credentials: true,
    },
    allowRequest(req, cb) {
      const origin = req.headers.origin;
      if (typeof origin !== "string" || !origin) return cb(null, true);
      cb(null, isTrustedOrigin(req as any, origin));
    },
  });

  // Share express-session with socket.io
  io.engine.use(sessionMiddleware);

  onInternalMessage(({ senderUserId, recipientUserId, message }) => {
    io.to(`user:${senderUserId}`)
      .to(`user:${recipientUserId}`)
      .emit("internal-message", { message });
  });

  io.use((socket, next) => {
    const req = socket.request as any;
    const userId = req?.session?.userId;
    if (!userId) {
      next(new Error("unauthorized"));
      return;
    }
    socket.data.userId = userId;
    next();
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId as number;
    const subs = new Map<string, () => void>();
    socket.join(`user:${userId}`);
    markUserOnline(userId);
    logger.info({ userId, sid: socket.id }, "socket connected");

    socket.on("subscribe-device", async (sessionId: string) => {
      if (subs.has(sessionId)) return; // already subscribed
      const device = await findDeviceBySessionForUser(userId, sessionId);
      if (!device) {
        socket.emit("error", { error: "Device not found" });
        return;
      }
      socket.join(`device:${sessionId}`);

      const off = waManager.subscribe(sessionId, (event, payload) => {
        socket.emit(event, { sessionId, ...((payload as object) || {}) });
      });
      subs.set(sessionId, off);

      const state = waManager.getState(sessionId);
      if (state) {
        socket.emit("status", { sessionId, status: state.status, phoneNumber: state.phoneNumber, profileName: state.profileName });
        if (state.qrDataUrl) socket.emit("qr", { sessionId, qr: state.qrDataUrl });
      } else {
        socket.emit("status", { sessionId, status: device.status });
      }
    });

    socket.on("unsubscribe-device", (sessionId: string) => {
      const off = subs.get(sessionId);
      if (off) {
        off();
        subs.delete(sessionId);
        socket.leave(`device:${sessionId}`);
      }
    });

    socket.on("disconnect", () => {
      for (const off of subs.values()) off();
      subs.clear();
      markUserOffline(userId);
    });
  });

  return io;
}
