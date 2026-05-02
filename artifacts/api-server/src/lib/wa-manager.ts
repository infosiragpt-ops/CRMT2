import path from "node:path";
import fs from "node:fs";
import { logger } from "./logger";
import {
  db,
  devicesTable,
  chatsTable,
  messagesTable,
} from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import QRCode from "qrcode";
import { ensureChat } from "./chats";
import { publicUrlFor, UPLOADS_DIR } from "./uploads";

// whatsapp-web.js is CJS — load via createRequire so esbuild leaves it alone (it is in externals)
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

type WAClient = {
  initialize: () => Promise<void>;
  destroy: () => Promise<void>;
  logout: () => Promise<void>;
  getChats: () => Promise<unknown[]>;
  getChatById: (id: string) => Promise<unknown>;
  getProfilePicUrl?: (id: string) => Promise<string | undefined>;
  getContactLidAndPhone?: (ids: string[]) => Promise<Array<{ lid?: string; pn?: string }>>;
  sendSeen?: (chatId: string) => Promise<boolean>;
  sendMessage: (chatId: string, content: unknown, options?: unknown) => Promise<unknown>;
  on: (event: string, fn: (...args: any[]) => void) => void;
  info?: { wid: { user: string }; pushname: string };
};

type WAContactLike = {
  id?: unknown;
  number?: string;
  getProfilePicUrl?: () => Promise<string | undefined>;
};

type WAChatLike = {
  id?: unknown;
  getContact?: () => Promise<WAContactLike>;
};

type PhoneResolution = {
  phoneNumber: string;
  source: "whatsapp-id" | "lid-resolution" | "contact";
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
  deviceRowId?: number;
  activeChatId?: string; // chat the operator currently has open (suppresses unread bump)
}

function sanitizeFileName(value: string) {
  return value
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 180) || "archivo";
}

function extensionForMime(mimeType: string) {
  if (mimeType.includes("jpeg")) return ".jpg";
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("webp")) return ".webp";
  if (mimeType.includes("gif")) return ".gif";
  if (mimeType.includes("pdf")) return ".pdf";
  if (mimeType.includes("wordprocessingml")) return ".docx";
  if (mimeType.includes("spreadsheetml")) return ".xlsx";
  if (mimeType.includes("presentationml")) return ".pptx";
  if (mimeType.includes("msword")) return ".doc";
  if (mimeType.includes("excel")) return ".xls";
  if (mimeType.includes("powerpoint")) return ".ppt";
  if (mimeType.startsWith("audio/")) return ".ogg";
  if (mimeType.startsWith("video/")) return ".mp4";
  return "";
}

function defaultMediaName(payload: ReturnType<typeof serializeMessage>, mimeType: string) {
  const ext = extensionForMime(mimeType);
  if (payload.type === "image" || mimeType.startsWith("image/")) return `imagen-${payload.timestamp}${ext}`;
  if (payload.type === "video" || mimeType.startsWith("video/")) return `video-${payload.timestamp}${ext}`;
  if (payload.type === "audio" || mimeType.startsWith("audio/")) return `audio-${payload.timestamp}${ext}`;
  return `documento-${payload.timestamp}${ext}`;
}

function serializedWid(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (!value || typeof value !== "object") return null;
  const serialized = (value as { _serialized?: unknown })._serialized;
  return typeof serialized === "string" && serialized.trim() ? serialized : null;
}

function digitsOnly(value: unknown): string {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

function phoneNumberFromSerializedWid(value: string | null | undefined): string | null {
  if (!value) return null;
  const [user, server] = value.trim().split("@");
  if (!user || !server) return null;
  if (server !== "c.us" && server !== "s.whatsapp.net") return null;
  const digits = digitsOnly(user);
  return digits.length >= 6 ? digits : null;
}

function phoneNumberFromResolvedValue(value: unknown): string | null {
  const serialized = serializedWid(value);
  const fromWid = phoneNumberFromSerializedWid(serialized);
  if (fromWid) return fromWid;
  const digits = digitsOnly(value);
  return digits.length >= 6 ? digits : null;
}

function phoneCodeFromNumber(value: string | null | undefined): string | null {
  const digits = digitsOnly(value);
  return digits.length >= 6 ? digits.slice(-6) : null;
}

function normalizedLid(value: unknown): string | null {
  const raw = serializedWid(value) ?? (typeof value === "string" ? value.trim() : "");
  if (!raw) return null;
  if (raw.endsWith("@lid")) return raw;
  const digits = digitsOnly(raw);
  return digits ? `${digits}@lid` : null;
}

function cleanProfilePicUrl(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function addProfilePicCandidate(candidates: string[], value: string | null | undefined) {
  if (value && !candidates.includes(value)) candidates.push(value);
}

function addPhoneProfilePicCandidates(candidates: string[], value: unknown) {
  const phoneNumber = phoneNumberFromResolvedValue(value);
  if (!phoneNumber) return;
  addProfilePicCandidate(candidates, `${phoneNumber}@c.us`);
  addProfilePicCandidate(candidates, `${phoneNumber}@s.whatsapp.net`);
}

class WAManager {
  private devices = new Map<string, DeviceState>();
  private listeners = new Map<string, Set<Listener>>();
  private recentMessageIds = new Map<string, number>();
  private profilePicCache = new Map<string, { url: string | null; expiresAt: number }>();

  private async getCachedProfilePicUrl(
    sessionId: string,
    state: DeviceState,
    chatId: string,
    forceRefresh = false,
  ): Promise<string | null> {
    const key = `${sessionId}:${chatId}`;
    const cached = this.profilePicCache.get(key);
    const now = Date.now();
    if (!forceRefresh && cached && cached.expiresAt > now) return cached.url;

    let url: string | null = null;
    try {
      const candidates: string[] = [];
      addProfilePicCandidate(candidates, chatId);

      if (chatId.endsWith("@lid") && typeof state.client.getContactLidAndPhone === "function") {
        const [resolved] = await state.client.getContactLidAndPhone([chatId]);
        addProfilePicCandidate(candidates, resolved?.lid);
        addPhoneProfilePicCandidates(candidates, resolved?.pn);
      }

      const chat = (await state.client.getChatById(chatId)) as WAChatLike;
      if (typeof chat.getContact === "function") {
        const contact = await chat.getContact();
        addProfilePicCandidate(candidates, serializedWid(contact.id));
        addPhoneProfilePicCandidates(candidates, contact.number);
        if (!url && typeof contact.getProfilePicUrl === "function") {
          try {
            url = cleanProfilePicUrl(await contact.getProfilePicUrl());
          } catch {
            url = null;
          }
        }
      }

      if (typeof state.client.getProfilePicUrl === "function") {
        for (const candidate of candidates) {
          if (url) break;
          try {
            url = cleanProfilePicUrl(await state.client.getProfilePicUrl(candidate));
          } catch {
            url = null;
          }
        }
      }
    } catch {
      url = null;
    }

    this.profilePicCache.set(key, { url, expiresAt: now + (url ? 60 * 60_000 : 90_000) });
    if (this.profilePicCache.size > 2000) {
      for (const [cacheKey, value] of this.profilePicCache) {
        if (value.expiresAt <= now || this.profilePicCache.size > 2000) {
          this.profilePicCache.delete(cacheKey);
        }
      }
    }
    return url;
  }

  async getProfilePicUrl(sessionId: string, chatId: string, forceRefresh = false) {
    const s = this.devices.get(sessionId);
    if (!s || s.status !== "ready") throw new Error("Device not ready");
    return this.getCachedProfilePicUrl(sessionId, s, chatId, forceRefresh);
  }

  private rememberMessage(sessionId: string, waMessageId: string | null | undefined): boolean {
    if (!waMessageId) return true;
    const now = Date.now();
    const key = `${sessionId}:${waMessageId}`;
    if (this.recentMessageIds.has(key)) return false;
    this.recentMessageIds.set(key, now);

    if (this.recentMessageIds.size > 3000) {
      const cutoff = now - 10 * 60_000;
      for (const [seenKey, seenAt] of this.recentMessageIds) {
        if (seenAt < cutoff || this.recentMessageIds.size > 3000) {
          this.recentMessageIds.delete(seenKey);
        }
      }
    }
    return true;
  }

  private handleMessageEvent(sessionId: string, state: DeviceState, msg: any) {
    const payload = serializeMessage(msg);
    if (!this.rememberMessage(sessionId, payload.id)) return;
    void this.persistMessage(sessionId, state, msg, payload).then((storedPayload) => {
      if (storedPayload) this.emit(sessionId, "message", storedPayload);
    });
  }

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

  setActiveChat(sessionId: string, waChatId: string | null) {
    const s = this.devices.get(sessionId);
    if (!s) return;
    s.activeChatId = waChatId ?? undefined;
  }

  private emit(sessionId: string, event: string, payload: unknown) {
    const set = this.listeners.get(sessionId);
    if (!set) return;
    for (const l of set) {
      try { l(event, payload); } catch (err) { logger.error({ err }, "listener error"); }
    }
  }

  getState(sessionId: string): Omit<DeviceState, "client" | "deviceRowId" | "activeChatId"> | null {
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

    // Cache the DB device row id so message handlers avoid a round-trip per event.
    const [deviceRow] = await db
      .select({ id: devicesTable.id })
      .from(devicesTable)
      .where(eq(devicesTable.sessionId, sessionId));
    state.deviceRowId = deviceRow?.id;

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
      this.handleMessageEvent(sessionId, state, msg);
    });

    client.on("message_create", (msg: any) => {
      this.handleMessageEvent(sessionId, state, msg);
    });

    client.initialize().catch((err) => {
      logger.error({ err, sessionId }, "WA client initialize failed");
      state.status = "disconnected";
      this.emit(sessionId, "status", { status: "disconnected", error: String(err) });
      this.devices.delete(sessionId);
    });
  }

  private async persistMessage(
    sessionId: string,
    state: DeviceState,
    rawMsg: any,
    payload: ReturnType<typeof serializeMessage>,
  ): Promise<ReturnType<typeof serializeMessage> | null> {
    try {
      if (!state.deviceRowId) {
        const [row] = await db
          .select({ id: devicesTable.id })
          .from(devicesTable)
          .where(eq(devicesTable.sessionId, sessionId));
        if (!row) return null;
        state.deviceRowId = row.id;
      }
      const deviceRowId = state.deviceRowId;
      if (!deviceRowId) return null;
      const waChatId = payload.chatId;
      let chatName = "";
      let isGroup = false;
      try {
        const chat = await rawMsg.getChat?.();
        if (chat) {
          chatName = chat.name || chat.formattedTitle || "";
          isGroup = !!chat.isGroup;
        }
      } catch { /* noop */ }
      const chatRow = await ensureChat({
        deviceId: deviceRowId,
        waChatId,
        name: chatName,
        isGroup,
      });
      const preview = payload.body?.slice(0, 200) || (payload.hasMedia ? `[${payload.type}]` : "");
      const incoming = !payload.fromMe;
      const isActive = state.activeChatId === waChatId;
      const bumpUnread = incoming && !isActive;
      const [inserted] = await db
        .insert(messagesTable)
        .values({
          chatId: chatRow.id,
          waMessageId: payload.id,
          fromMe: payload.fromMe,
          author: payload.author ?? null,
          body: payload.body,
          type: payload.type,
          hasMedia: payload.hasMedia,
          timestamp: payload.timestamp,
        })
        .onConflictDoNothing()
        .returning({ id: messagesTable.id });

      if (!inserted) return null;

      const media = payload.hasMedia
        ? await this.saveMessageMedia(sessionId, rawMsg, payload)
        : null;

      if (media?.mediaPath || media?.mediaType || media?.fileName) {
        await db
          .update(messagesTable)
          .set({
            mediaType: media.mediaType ?? payload.mediaMimeType ?? null,
            mediaPath: media.mediaPath ?? null,
            raw: media.fileName ? { fileName: media.fileName } : null,
          })
          .where(eq(messagesTable.id, inserted.id));
      }

      await db
        .update(chatsTable)
        .set({
          lastMessageAt: new Date(payload.timestamp * 1000),
          lastMessagePreview: preview,
          updatedAt: new Date(),
          ...(bumpUnread
            ? { unreadCount: sql`${chatsTable.unreadCount} + 1` }
            : {}),
        })
        .where(eq(chatsTable.id, chatRow.id));

      return {
        ...payload,
        mediaUrl: media?.mediaPath ? publicUrlFor(media.mediaPath) : payload.mediaUrl,
        mediaMimeType: media?.mediaType ?? payload.mediaMimeType,
        mediaFileName: media?.fileName ?? payload.mediaFileName,
      };
    } catch (err) {
      logger.error({ err, sessionId }, "persistMessage failed");
      return payload;
    }
  }

  private async saveMessageMedia(
    sessionId: string,
    rawMsg: any,
    payload: ReturnType<typeof serializeMessage>,
  ): Promise<{ mediaType: string | null; mediaPath: string | null; fileName: string | null } | null> {
    if (!payload.hasMedia || typeof rawMsg.downloadMedia !== "function") return null;
    try {
      const media = await rawMsg.downloadMedia();
      if (!media?.data) return null;

      const mediaType = (media.mimetype || payload.mediaMimeType || "application/octet-stream") as string;
      const fileName = sanitizeFileName(media.filename || payload.mediaFileName || defaultMediaName(payload, mediaType));
      const ext = path.extname(fileName) || extensionForMime(mediaType);
      const safeSession = sanitizeFileName(sessionId).replace(/\./g, "-");
      const safeMessageId = sanitizeFileName(payload.id).replace(/\./g, "-").slice(0, 90);
      const dir = path.join(UPLOADS_DIR, "wa-media", safeSession);
      await fs.promises.mkdir(dir, { recursive: true });
      const mediaPath = path.join(dir, `${payload.timestamp}-${safeMessageId}${ext}`);
      await fs.promises.writeFile(mediaPath, Buffer.from(media.data, "base64"));

      return { mediaType, mediaPath, fileName };
    } catch (err) {
      logger.warn({ err, sessionId, messageId: payload.id }, "download media failed");
      return null;
    }
  }

  private async enrichMessagesFromDb(
    state: DeviceState,
    waChatId: string,
    payloads: ReturnType<typeof serializeMessage>[],
  ): Promise<ReturnType<typeof serializeMessage>[]> {
    if (!state.deviceRowId || payloads.length === 0) return payloads;
    try {
      const [chatRow] = await db
        .select({ id: chatsTable.id })
        .from(chatsTable)
        .where(and(eq(chatsTable.deviceId, state.deviceRowId), eq(chatsTable.waChatId, waChatId)));
      if (!chatRow) return payloads;

      const ids = payloads.map((payload) => payload.id).filter(Boolean);
      if (ids.length === 0) return payloads;
      type StoredMessageMedia = {
        waMessageId: string;
        mediaType: string | null;
        mediaPath: string | null;
        raw: unknown;
      };
      const rows = (await db
        .select({
          waMessageId: messagesTable.waMessageId,
          mediaType: messagesTable.mediaType,
          mediaPath: messagesTable.mediaPath,
          raw: messagesTable.raw,
        })
        .from(messagesTable)
        .where(and(eq(messagesTable.chatId, chatRow.id), inArray(messagesTable.waMessageId, ids)))) as StoredMessageMedia[];
      const byId = new Map<string, StoredMessageMedia>(rows.map((row) => [row.waMessageId, row]));

      return payloads.map((payload) => {
        const row = byId.get(payload.id);
        const raw = row?.raw as { fileName?: unknown } | null | undefined;
        const storedFileName = typeof raw?.fileName === "string" ? raw.fileName : null;
        return {
          ...payload,
          mediaUrl: row?.mediaPath ? publicUrlFor(row.mediaPath) : payload.mediaUrl,
          mediaMimeType: row?.mediaType ?? payload.mediaMimeType,
          mediaFileName: storedFileName ?? payload.mediaFileName,
        };
      });
    } catch (err) {
      logger.warn({ err, waChatId }, "message media enrichment failed");
      return payloads;
    }
  }

  private async getStoredMessages(
    state: DeviceState,
    waChatId: string,
    limit: number,
  ): Promise<ReturnType<typeof serializeMessage>[]> {
    if (!state.deviceRowId) return [];
    try {
      const [chatRow] = await db
        .select({ id: chatsTable.id })
        .from(chatsTable)
        .where(and(eq(chatsTable.deviceId, state.deviceRowId), eq(chatsTable.waChatId, waChatId)));
      if (!chatRow) return [];
      type StoredMessage = {
        waMessageId: string;
        fromMe: boolean;
        author: string | null;
        body: string;
        type: string;
        hasMedia: boolean;
        mediaType: string | null;
        mediaPath: string | null;
        raw: unknown;
        timestamp: number;
      };
      const rows = (await db
        .select({
          waMessageId: messagesTable.waMessageId,
          fromMe: messagesTable.fromMe,
          author: messagesTable.author,
          body: messagesTable.body,
          type: messagesTable.type,
          hasMedia: messagesTable.hasMedia,
          mediaType: messagesTable.mediaType,
          mediaPath: messagesTable.mediaPath,
          raw: messagesTable.raw,
          timestamp: messagesTable.timestamp,
        })
        .from(messagesTable)
        .where(eq(messagesTable.chatId, chatRow.id))
        .orderBy(desc(messagesTable.timestamp))
        .limit(limit)) as StoredMessage[];

      return rows.reverse().map((row) => {
        const raw = row.raw as { fileName?: unknown } | null | undefined;
        const fileName = typeof raw?.fileName === "string" ? raw.fileName : null;
        return {
          id: row.waMessageId,
          chatId: waChatId,
          from: row.fromMe ? "me" : waChatId,
          to: row.fromMe ? waChatId : "me",
          body: row.body,
          fromMe: row.fromMe,
          timestamp: row.timestamp,
          hasMedia: row.hasMedia,
          type: row.type,
          author: row.author,
          mediaUrl: row.mediaPath ? publicUrlFor(row.mediaPath) : null,
          mediaMimeType: row.mediaType,
          mediaFileName: fileName,
        };
      });
    } catch (err) {
      logger.warn({ err, waChatId }, "stored message fallback failed");
      return [];
    }
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

  private async resolveLidPhoneNumbers(
    client: WAClient,
    ids: string[],
  ): Promise<Map<string, PhoneResolution>> {
    const uniqueIds = Array.from(new Set(ids.filter((id) => id.endsWith("@lid"))));
    const requested = new Set(uniqueIds);
    const resolvedPhones = new Map<string, PhoneResolution>();
    if (uniqueIds.length === 0 || typeof client.getContactLidAndPhone !== "function") {
      return resolvedPhones;
    }

    try {
      const rows = await client.getContactLidAndPhone(uniqueIds);
      rows.forEach((row) => {
        const lid = normalizedLid(row.lid);
        const phoneNumber = phoneNumberFromResolvedValue(row.pn);
        // Never map by array position. If WhatsApp does not echo the LID, the
        // association is ambiguous and must be treated as unverified.
        if (lid && requested.has(lid) && phoneNumber) {
          resolvedPhones.set(lid, { phoneNumber, source: "lid-resolution" });
        }
      });
    } catch (err) {
      logger.warn({ err }, "failed to resolve WhatsApp LID phone numbers");
    }

    return resolvedPhones;
  }

  async getChats(sessionId: string) {
    const s = this.devices.get(sessionId);
    if (!s || s.status !== "ready") throw new Error("Device not ready");
    const chats = (await s.client.getChats()) as any[];
    const lidIds: string[] = [];
    for (const c of chats) {
      const chatId = serializedWid(c.id) ?? String(c.id ?? "");
      if (chatId.endsWith("@lid")) lidIds.push(chatId);
      if (Array.isArray(c.participants)) {
        for (const participant of c.participants) {
          const participantId = serializedWid(participant.id) ?? String(participant.id ?? "");
          if (participantId.endsWith("@lid")) lidIds.push(participantId);
        }
      }
    }
    const lidPhones = await this.resolveLidPhoneNumbers(s.client, lidIds);

    const mapped = await Promise.all(chats.map(async (c) => {
      const id = c.id?._serialized ?? c.id;
      const serializedId = String(id);
      const directPhoneFromId = phoneNumberFromSerializedWid(serializedId);
      const lidPhone = lidPhones.get(serializedId) ?? null;
      let phoneNumber = directPhoneFromId ?? lidPhone?.phoneNumber ?? null;
      let phoneCodeSource: PhoneResolution["source"] | null = directPhoneFromId
        ? "whatsapp-id"
        : lidPhone?.source ?? null;
      if (!c.isGroup && !phoneNumber && typeof c.getContact === "function") {
        try {
          const contact = await c.getContact();
          phoneNumber =
            phoneNumberFromSerializedWid(serializedWid(contact.id)) ??
            phoneNumberFromResolvedValue(contact.number);
          phoneCodeSource = phoneNumber ? "contact" : null;
        } catch {
          phoneNumber = null;
          phoneCodeSource = null;
        }
      }
      const phoneCode = phoneCodeFromNumber(phoneNumber);
      const participants = Array.isArray(c.participants)
        ? c.participants.map((participant: any) => {
            const participantId = serializedWid(participant.id) ?? String(participant.id ?? "");
            const participantUser = participant.id?.user ?? participantId.split("@")[0] ?? "";
            const participantLidPhone = lidPhones.get(participantId) ?? null;
            const participantDirectPhoneNumber = phoneNumberFromSerializedWid(participantId);
            const participantPhoneNumber =
              participantDirectPhoneNumber ??
              participantLidPhone?.phoneNumber ??
              null;
            const participantPhoneCodeSource: PhoneResolution["source"] | null =
              participantDirectPhoneNumber ? "whatsapp-id" : participantLidPhone?.source ?? null;
            return {
              id: participantId,
              name: participant.name || participant.pushname || participant.shortName || participantUser,
              phoneNumber: participantPhoneNumber,
              phoneCode: phoneCodeFromNumber(participantPhoneNumber),
              phoneCodeVerified: !!participantPhoneNumber,
              phoneCodeSource: participantPhoneCodeSource,
              isAdmin: !!participant.isAdmin || !!participant.isSuperAdmin,
            };
          })
        : [];
      return {
        id: serializedId,
        name: c.name || c.formattedTitle || c.id?.user || "",
        isGroup: c.isGroup,
        phoneNumber,
        phoneCode,
        phoneCodeVerified: !!phoneNumber,
        phoneCodeSource,
        participants,
        unreadCount: c.unreadCount ?? 0,
        timestamp: c.timestamp ?? null,
        lastMessage: c.lastMessage ? serializeMessage(c.lastMessage) : null,
        profilePicUrl: null as string | null,
      };
    }));

    return mapped;
  }

  async getMessages(sessionId: string, chatId: string, limit = 50) {
    const s = this.devices.get(sessionId);
    if (!s || s.status !== "ready") throw new Error("Device not ready");
    try {
      const chat = (await s.client.getChatById(chatId)) as any;
      const msgs = (await chat.fetchMessages({ limit })) as any[];
      const serialized = msgs.map(serializeMessage);
      return this.enrichMessagesFromDb(s, chatId, serialized);
    } catch (err) {
      logger.warn({ err, sessionId, chatId }, "live fetchMessages failed; using stored messages");
      return this.getStoredMessages(s, chatId, limit);
    }
  }

  async markChatSeen(sessionId: string, chatId: string) {
    const s = this.devices.get(sessionId);
    if (!s || s.status !== "ready") return false;
    if (typeof s.client.sendSeen === "function") {
      return s.client.sendSeen(chatId);
    }
    const chat = (await s.client.getChatById(chatId)) as { sendSeen?: () => Promise<boolean> };
    return chat.sendSeen?.() ?? false;
  }

  async sendMessage(sessionId: string, chatId: string, body: string, quotedMessageId?: string) {
    const s = this.devices.get(sessionId);
    if (!s || s.status !== "ready") throw new Error("Device not ready");
    const sent = await s.client.sendMessage(
      chatId,
      body,
      quotedMessageId ? { quotedMessageId, ignoreQuoteErrors: false } : undefined,
    );
    return serializeMessage(sent);
  }

  async sendMedia(
    sessionId: string,
    chatId: string,
    filePath: string,
    mimeType: string,
    fileName: string,
    caption?: string,
  ) {
    const s = this.devices.get(sessionId);
    if (!s || s.status !== "ready") throw new Error("Device not ready");
    const { MessageMedia } = require("whatsapp-web.js") as {
      MessageMedia: {
        fromFilePath: (path: string) => { mimetype: string; filename: string; data: string };
      };
    };
    const media = MessageMedia.fromFilePath(filePath);
    media.filename = fileName;
    media.mimetype = mimeType;
    const sent = await s.client.sendMessage(chatId, media, caption ? { caption } : undefined);
    return serializeMessage(sent);
  }
}

function serializeMessage(m: any) {
  const chatId = m.from === m.to ? m.from : (m.fromMe ? m.to : m.from);
  const mediaMimeType = (m._data?.mimetype ?? m.mimetype ?? null) as string | null;
  const mediaFileName = (m._data?.filename ?? m.filename ?? null) as string | null;
  const quoted = m._data?.quotedMsg ?? null;
  const quotedId =
    m._data?.quotedStanzaID ??
    quoted?.id?._serialized ??
    quoted?.id?.id ??
    null;
  const quotedParticipantRaw =
    m._data?.quotedParticipant ??
    quoted?.author ??
    quoted?.from ??
    quoted?.id?.remote ??
    null;
  const quotedParticipant =
    typeof quotedParticipantRaw === "string"
      ? quotedParticipantRaw
      : (quotedParticipantRaw?._serialized ?? null);
  const quotedBody =
    quoted?.body ??
    quoted?.caption ??
    quoted?.pollName ??
    (quoted?.type ? `[${quoted.type}]` : null);
  const quotedFromMe =
    typeof quoted?.id?.fromMe === "boolean"
      ? quoted.id.fromMe
      : typeof quoted?.fromMe === "boolean"
        ? quoted.fromMe
        : null;
  return {
    id: (m.id?._serialized ?? m.id) as string,
    chatId: chatId as string,
    from: m.from as string,
    to: m.to as string,
    body: (m.body ?? "") as string,
    fromMe: !!m.fromMe,
    timestamp: (m.timestamp ?? Math.floor(Date.now() / 1000)) as number,
    hasMedia: !!m.hasMedia,
    type: (m.type ?? "chat") as string,
    author: (m.author ?? null) as string | null,
    mediaUrl: null as string | null,
    mediaMimeType,
    mediaFileName,
    quotedMessageId: quotedId as string | null,
    quotedBody: (quotedBody ?? null) as string | null,
    quotedParticipant: quotedParticipant as string | null,
    quotedFromMe,
  };
}

export const waManager = new WAManager();
