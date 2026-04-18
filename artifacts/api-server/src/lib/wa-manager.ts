import path from "node:path";
import fs from "node:fs";
import { logger } from "./logger";
import { db, devicesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";

// whatsapp-web.js is CJS — load via createRequire so esbuild leaves it alone (it is in externals)
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

type WAClient = {
  initialize: () => Promise<void>;
  destroy: () => Promise<void>;
  logout: () => Promise<void>;
  getChats: () => Promise<unknown[]>;
  getChatById: (id: string) => Promise<unknown>;
  sendMessage: (chatId: string, content: string) => Promise<unknown>;
  on: (event: string, fn: (...args: any[]) => void) => void;
  info?: { wid: { user: string }; pushname: string };
};

const SESSIONS_DIR = process.env.WA_SESSIONS_DIR || path.resolve(process.cwd(), ".wa-sessions");
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

type Listener = (event: string, payload: unknown) => void;

interface DeviceState {
  client: WAClient;
  status: "starting" | "qr" | "authenticated" | "ready" | "disconnected" | "auth_failure";
  qrDataUrl?: string;
  phoneNumber?: string;
  profileName?: string;
}

class WAManager {
  private devices = new Map<string, DeviceState>();
  private listeners = new Map<string, Set<Listener>>();

  subscribe(sessionId: string, listener: Listener): () => void {
    let set = this.listeners.get(sessionId);
    if (!set) {
      set = new Set();
      this.listeners.set(sessionId, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
    };
  }

  private emit(sessionId: string, event: string, payload: unknown) {
    const set = this.listeners.get(sessionId);
    if (!set) return;
    for (const l of set) {
      try { l(event, payload); } catch (err) { logger.error({ err }, "listener error"); }
    }
  }

  getState(sessionId: string): Omit<DeviceState, "client"> | null {
    const s = this.devices.get(sessionId);
    if (!s) return null;
    return { status: s.status, qrDataUrl: s.qrDataUrl, phoneNumber: s.phoneNumber, profileName: s.profileName };
  }

  hasClient(sessionId: string): boolean {
    return this.devices.has(sessionId);
  }

  private startPromises = new Map<string, Promise<void>>();

  async start(sessionId: string): Promise<void> {
    const existingStart = this.startPromises.get(sessionId);
    if (existingStart) return existingStart;
    const p = this.doStart(sessionId).finally(() => this.startPromises.delete(sessionId));
    this.startPromises.set(sessionId, p);
    return p;
  }

  private async doStart(sessionId: string): Promise<void> {
    if (this.devices.has(sessionId)) {
      const s = this.devices.get(sessionId)!;
      if (s.qrDataUrl) this.emit(sessionId, "qr", { qr: s.qrDataUrl });
      this.emit(sessionId, "status", { status: s.status });
      return;
    }

    const { Client, LocalAuth } = require("whatsapp-web.js") as {
      Client: new (opts: unknown) => WAClient;
      LocalAuth: new (opts: unknown) => unknown;
    };

    const client = new Client({
      authStrategy: new LocalAuth({ clientId: sessionId, dataPath: SESSIONS_DIR }),
      puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--disable-gpu",
          "--no-first-run",
          "--no-zygote",
          "--single-process",
          "--disable-extensions",
        ],
      },
    });

    const state: DeviceState = { client, status: "starting" };
    this.devices.set(sessionId, state);

    client.on("qr", async (qr: string) => {
      try {
        const dataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 1 });
        state.qrDataUrl = dataUrl;
        state.status = "qr";
        this.emit(sessionId, "qr", { qr: dataUrl });
        this.emit(sessionId, "status", { status: "qr" });
        await db.update(devicesTable).set({ status: "qr" }).where(eq(devicesTable.sessionId, sessionId));
      } catch (err) {
        logger.error({ err }, "qr render error");
      }
    });

    client.on("authenticated", async () => {
      state.status = "authenticated";
      state.qrDataUrl = undefined;
      this.emit(sessionId, "status", { status: "authenticated" });
      await db.update(devicesTable).set({ status: "authenticated" }).where(eq(devicesTable.sessionId, sessionId));
    });

    client.on("auth_failure", async (msg: string) => {
      state.status = "auth_failure";
      this.emit(sessionId, "status", { status: "auth_failure", error: msg });
      await db.update(devicesTable).set({ status: "auth_failure" }).where(eq(devicesTable.sessionId, sessionId));
    });

    client.on("ready", async () => {
      state.status = "ready";
      state.phoneNumber = client.info?.wid.user;
      state.profileName = client.info?.pushname;
      this.emit(sessionId, "status", { status: "ready", phoneNumber: state.phoneNumber, profileName: state.profileName });
      await db.update(devicesTable).set({
        status: "ready",
        phoneNumber: state.phoneNumber,
        profileName: state.profileName,
        lastConnectedAt: new Date(),
      }).where(eq(devicesTable.sessionId, sessionId));
    });

    client.on("disconnected", async (reason: string) => {
      state.status = "disconnected";
      this.emit(sessionId, "status", { status: "disconnected", reason });
      await db.update(devicesTable).set({ status: "disconnected" }).where(eq(devicesTable.sessionId, sessionId));
      this.devices.delete(sessionId);
    });

    client.on("message", (msg: any) => {
      this.emit(sessionId, "message", serializeMessage(msg));
    });

    client.on("message_create", (msg: any) => {
      this.emit(sessionId, "message", serializeMessage(msg));
    });

    client.initialize().catch((err) => {
      logger.error({ err, sessionId }, "WA client initialize failed");
      state.status = "disconnected";
      this.emit(sessionId, "status", { status: "disconnected", error: String(err) });
      this.devices.delete(sessionId);
    });
  }

  async stop(sessionId: string, removeData = false): Promise<void> {
    const s = this.devices.get(sessionId);
    if (s) {
      try {
        if (removeData) await s.client.logout();
      } catch (err) { logger.warn({ err }, "logout failed"); }
      try { await s.client.destroy(); } catch { /* noop */ }
      this.devices.delete(sessionId);
    }
    if (removeData) {
      const dir = path.join(SESSIONS_DIR, `session-${sessionId}`);
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
    }
  }

  async getChats(sessionId: string) {
    const s = this.devices.get(sessionId);
    if (!s || s.status !== "ready") throw new Error("Device not ready");
    const chats = (await s.client.getChats()) as any[];
    return chats.map((c) => ({
      id: c.id?._serialized ?? c.id,
      name: c.name || c.formattedTitle || c.id?.user || "",
      isGroup: c.isGroup,
      unreadCount: c.unreadCount ?? 0,
      timestamp: c.timestamp ?? null,
      lastMessage: c.lastMessage ? serializeMessage(c.lastMessage) : null,
    }));
  }

  async getMessages(sessionId: string, chatId: string, limit = 50) {
    const s = this.devices.get(sessionId);
    if (!s || s.status !== "ready") throw new Error("Device not ready");
    const chat = (await s.client.getChatById(chatId)) as any;
    const msgs = (await chat.fetchMessages({ limit })) as any[];
    return msgs.map(serializeMessage);
  }

  async sendMessage(sessionId: string, chatId: string, body: string) {
    const s = this.devices.get(sessionId);
    if (!s || s.status !== "ready") throw new Error("Device not ready");
    const sent = await s.client.sendMessage(chatId, body);
    return serializeMessage(sent);
  }
}

function serializeMessage(m: any) {
  return {
    id: m.id?._serialized ?? m.id,
    chatId: m.from === m.to ? m.from : (m.fromMe ? m.to : m.from),
    from: m.from,
    to: m.to,
    body: m.body ?? "",
    fromMe: !!m.fromMe,
    timestamp: m.timestamp ?? Math.floor(Date.now() / 1000),
    hasMedia: !!m.hasMedia,
    type: m.type ?? "chat",
    author: m.author ?? null,
  };
}

export const waManager = new WAManager();
