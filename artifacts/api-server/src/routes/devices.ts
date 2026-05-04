import { Router, type IRouter } from "express";
import {
  db,
  devicesTable,
  chatsTable,
  messagesTable,
  chatLabelsTable,
  labelsTable,
  usersTable,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { requireAdmin, requireAuth } from "../lib/auth";
import { waManager } from "../lib/wa-manager";
import { publicUrlFor, uploadChatMedia, UPLOADS_DIR } from "../lib/uploads";
import { blockedPhoneNumberMessage, containsBlockedPhoneNumber } from "../lib/message-security";
import { findDeviceBySessionForUser, findDevicesForUser } from "../lib/chats";
import { ensureChatAssignmentsSchema } from "../lib/chat-assignments-schema";
import { requirePermission } from "../lib/permissions";
import { logger } from "../lib/logger";
import { enqueueWaJob, isWaJobQueueEnabled } from "../lib/job-queue";

const router: IRouter = Router();

router.use(requireAuth);
router.use((req, res, next) => {
  if (!req.path.endsWith("/profile-picture/image")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
    res.setHeader("ETag", `"${crypto.randomUUID()}"`);
  }
  next();
});

type StoredChatRow = {
  id: number;
  waChatId: string;
  name: string;
  customName: string | null;
  phoneNumber: string | null;
  phoneCode: string | null;
  phoneCodeVerified: boolean;
  phoneCodeSource: "whatsapp-id" | "lid-resolution" | "contact" | null;
  isGroup: boolean;
  archived: boolean;
  favorited: boolean;
  pinned: boolean;
  muted: boolean;
  emailNotifications: boolean;
  manuallyUnread: boolean;
  assignedUserId: number | null;
  assignedByUserId: number | null;
  assignedAt: Date | null;
  unreadCount: number;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  updatedAt: Date;
};

type LiveChatRow = {
  id: string;
  unreadCount?: number | null;
  profilePicUrl?: string | null;
  phoneNumber?: string | null;
  phoneCode?: string | null;
  phoneCodeVerified?: boolean;
  phoneCodeSource?: "whatsapp-id" | "lid-resolution" | "contact" | null;
};

type GroupParticipantRow = {
  id: string;
  name?: string | null;
  phoneNumber?: string | null;
  phoneCode?: string | null;
  phoneCodeVerified?: boolean;
  phoneCodeSource?: "whatsapp-id" | "lid-resolution" | "contact" | null;
  isAdmin?: boolean;
};

type DeviceRow = {
  id: number;
  sessionId: string;
  status: string;
};

type AssignmentUserRow = {
  id: number;
  username: string;
  displayName: string;
  labelColor: string;
};

const PROFILE_PIC_CACHE_DIR = path.join(UPLOADS_DIR, "profile-pictures");
const PROFILE_PIC_CACHE_MAX_AGE_MS = 12 * 60 * 60_000;
const LIVE_CHAT_LIST_TIMEOUT_MS = 1_500;
const PROFILE_PIC_LOOKUP_TIMEOUT_MS = 800;
const PROFILE_PIC_IMAGE_TIMEOUT_MS = 1_200;
const SLOW_OPERATION_MS = 300;
fs.mkdirSync(PROFILE_PIC_CACHE_DIR, { recursive: true });

type CachedProfilePicture = {
  filePath: string;
  contentType: string;
  updatedAt: number;
};

function logSlowOperation(startedAt: number, operation: string, meta: Record<string, unknown>) {
  const durationMs = Date.now() - startedAt;
  if (durationMs >= SLOW_OPERATION_MS) {
    logger.warn({ ...meta, durationMs }, operation);
  }
}

function refreshMessagesInBackground(
  device: Pick<DeviceRow, "sessionId">,
  chatId: string,
  limit: number,
  reason: string,
  options: { downloadMedia?: boolean } = {},
) {
  if (isWaJobQueueEnabled()) {
    void enqueueWaJob(
      "refresh-messages",
      { sessionId: device.sessionId, chatId, limit, reason, downloadMedia: options.downloadMedia === true },
      { jobId: `refresh_messages_${device.sessionId}_${chatId}_${reason}` },
    );
    return;
  }
  if (waManager.getState(device.sessionId)?.status !== "ready") return;
  void withTimeout(
    waManager.getMessages(device.sessionId, chatId, limit, { downloadMedia: options.downloadMedia === true }),
    10_000,
    "Background WhatsApp messages refresh timed out",
  ).catch((err) => {
    logger.warn({ err, sessionId: device.sessionId, chatId, reason }, "background message refresh failed");
  });
}

function warmRecentChatMessages(
  device: Pick<DeviceRow, "sessionId">,
  chats: Array<{ id: string; unreadCount?: number | null }>,
) {
  if (waManager.getState(device.sessionId)?.status !== "ready") return;
  const prioritized = chats
    .slice()
    .sort((a, b) => Number(b.unreadCount || 0) - Number(a.unreadCount || 0))
    .slice(0, 12);
  prioritized.forEach((chat) => {
    refreshMessagesInBackground(device, chat.id, 100, "warm-recent-chat", { downloadMedia: false });
  });
}

async function ownDevice(userId: number, sessionId: string) {
  const [d] = await db
    .select()
    .from(devicesTable)
    .where(and(eq(devicesTable.sessionId, sessionId), eq(devicesTable.userId, userId)));
  return d ?? null;
}

function profilePictureInfoPath(sessionId: string, chatId: string) {
  return `/api/devices/${encodeURIComponent(sessionId)}/chats/${encodeURIComponent(chatId)}/profile-picture`;
}

function profilePictureImagePath(sessionId: string, chatId: string) {
  return `/api/devices/${encodeURIComponent(sessionId)}/chats/${encodeURIComponent(chatId)}/profile-picture/image`;
}

function profilePictureCacheKey(sessionId: string, chatId: string) {
  return crypto.createHash("sha256").update(`${sessionId}:${chatId}`).digest("hex").slice(0, 48);
}

function profilePictureMetaPath(sessionId: string, chatId: string) {
  return path.join(PROFILE_PIC_CACHE_DIR, `${profilePictureCacheKey(sessionId, chatId)}.json`);
}

function profilePictureExtension(contentType: string) {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  return "jpg";
}

function cleanImageContentType(contentType: string | null) {
  const clean = (contentType || "").split(";")[0]?.trim().toLowerCase();
  return clean?.startsWith("image/") ? clean : "image/jpeg";
}

function readCachedProfilePicture(sessionId: string, chatId: string): CachedProfilePicture | null {
  try {
    const meta = JSON.parse(fs.readFileSync(profilePictureMetaPath(sessionId, chatId), "utf8")) as {
      fileName?: unknown;
      contentType?: unknown;
      updatedAt?: unknown;
    };
    if (typeof meta.fileName !== "string") return null;
    const filePath = path.join(PROFILE_PIC_CACHE_DIR, meta.fileName);
    const stat = fs.statSync(filePath);
    return {
      filePath,
      contentType: typeof meta.contentType === "string" ? meta.contentType : "image/jpeg",
      updatedAt: typeof meta.updatedAt === "number" ? meta.updatedAt : stat.mtimeMs,
    };
  } catch {
    return null;
  }
}

function cachedProfilePictureUrl(sessionId: string, chatId: string) {
  return readCachedProfilePicture(sessionId, chatId) ? profilePictureImagePath(sessionId, chatId) : null;
}

function writeCachedProfilePicture(sessionId: string, chatId: string, bytes: Buffer, contentType: string) {
  const key = profilePictureCacheKey(sessionId, chatId);
  const fileName = `${key}.${profilePictureExtension(contentType)}`;
  const filePath = path.join(PROFILE_PIC_CACHE_DIR, fileName);
  fs.writeFileSync(filePath, bytes);
  fs.writeFileSync(
    profilePictureMetaPath(sessionId, chatId),
    JSON.stringify({ fileName, contentType, updatedAt: Date.now() }),
  );
  return { filePath, contentType, updatedAt: Date.now() };
}

async function assignedUsersForChats(chats: StoredChatRow[]) {
  const ids = Array.from(
    new Set(chats.map((chat) => chat.assignedUserId).filter((id): id is number => Number.isInteger(id))),
  );
  if (!ids.length) return new Map<number, AssignmentUserRow>();
  const rows = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
      labelColor: usersTable.labelColor,
    })
    .from(usersTable)
    .where(inArray(usersTable.id, ids));
  return new Map(rows.map((row) => [row.id, row]));
}

function chatAssignment(chat: StoredChatRow | undefined, usersById: Map<number, AssignmentUserRow>) {
  if (!chat?.assignedUserId || !chat.assignedAt) return null;
  const user = usersById.get(chat.assignedUserId);
  if (!user) return null;
  return {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    color: user.labelColor || "#00a884",
    assignedByUserId: chat.assignedByUserId,
    assignedAt: chat.assignedAt.toISOString(),
  };
}

function sendCachedProfilePicture(res: import("express").Response, cached: CachedProfilePicture) {
  res.setHeader("Content-Type", cached.contentType);
  res.setHeader("Cache-Control", "private, max-age=900");
  res.sendFile(cached.filePath);
}

async function fetchProfilePicture(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROFILE_PIC_IMAGE_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function ensureDeviceClientRestoring(device: Pick<DeviceRow, "sessionId" | "status">) {
  if (waManager.getState(device.sessionId) || !["ready", "authenticated"].includes(device.status)) return;
  void waManager.start(device.sessionId).catch(() => undefined);
}

function phoneInfoFromWaChatId(chatId: string) {
  const [user, server] = chatId.trim().split("@");
  if (!user || (server !== "c.us" && server !== "s.whatsapp.net")) {
    return { phoneNumber: null, phoneCode: null, phoneCodeVerified: false, phoneCodeSource: null };
  }
  const digits = user.replace(/\D/g, "");
  if (digits.length < 6) {
    return { phoneNumber: null, phoneCode: null, phoneCodeVerified: false, phoneCodeSource: null };
  }
  return {
    phoneNumber: digits,
    phoneCode: digits.slice(-6),
    phoneCodeVerified: true,
    phoneCodeSource: "whatsapp-id" as const,
  };
}

function phoneInfoFromStoredChat(chat: StoredChatRow) {
  const storedDigits = (chat.phoneNumber || "").replace(/\D/g, "");
  const storedCode = storedDigits.length >= 6 ? storedDigits.slice(-6) : "";
  if (chat.phoneCodeVerified && storedCode.length === 6) {
    return {
      phoneNumber: storedDigits,
      phoneCode: storedCode,
      phoneCodeVerified: true,
      phoneCodeSource: chat.phoneCodeSource ?? "contact",
    };
  }
  return phoneInfoFromWaChatId(chat.waChatId);
}

async function chatLabelsForRows(chatIds: number[]) {
  if (chatIds.length === 0) return new Map<number, { id: number; name: string; color: string }[]>();
  const labelRows = await db
    .select({
      chatId: chatLabelsTable.chatId,
      id: labelsTable.id,
      name: labelsTable.name,
      color: labelsTable.color,
    })
    .from(chatLabelsTable)
    .innerJoin(labelsTable, eq(chatLabelsTable.labelId, labelsTable.id))
    .where(inArray(chatLabelsTable.chatId, chatIds));

  const labelsByChat = new Map<number, { id: number; name: string; color: string }[]>();
  for (const r of labelRows) {
    const list = labelsByChat.get(r.chatId) ?? [];
    list.push({ id: r.id, name: r.name, color: r.color });
    labelsByChat.set(r.chatId, list);
  }
  return labelsByChat;
}

function storedMessageFromRow(row: {
  waMessageId: string;
  waChatId: string;
  fromMe: boolean;
  author: string | null;
  body: string;
  type: string;
  hasMedia: boolean;
  mediaType: string | null;
  mediaPath: string | null;
  raw: unknown;
  timestamp: number;
}) {
  const raw = row.raw as { fileName?: unknown } | null | undefined;
  const fileName = typeof raw?.fileName === "string" ? raw.fileName : null;
  return {
    id: row.waMessageId,
    chatId: row.waChatId,
    from: row.fromMe ? "me" : row.waChatId,
    to: row.fromMe ? row.waChatId : "me",
    body: row.body,
    fromMe: row.fromMe,
    timestamp: row.timestamp,
    hasMedia: row.hasMedia,
    type: row.type,
    author: row.author,
    ack: null,
    isForwarded: false,
    isStarred: false,
    hasReaction: false,
    mediaUrl: row.mediaPath ? publicUrlFor(row.mediaPath) : null,
    mediaMimeType: row.mediaType,
    mediaFileName: fileName,
    quotedMessageId: null,
    quotedBody: null,
    quotedParticipant: null,
    quotedFromMe: null,
  };
}

async function getStoredMessages(deviceId: number, waChatId: string, limit: number) {
  const [chatRow] = await db
    .select({ id: chatsTable.id, waChatId: chatsTable.waChatId })
    .from(chatsTable)
    .where(and(eq(chatsTable.deviceId, deviceId), eq(chatsTable.waChatId, waChatId)));
  if (!chatRow) return [];

  const rows = await db
    .select({
      waMessageId: messagesTable.waMessageId,
      waChatId: chatsTable.waChatId,
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
    .innerJoin(chatsTable, eq(messagesTable.chatId, chatsTable.id))
    .where(eq(messagesTable.chatId, chatRow.id))
    .orderBy(desc(messagesTable.timestamp))
    .limit(limit);

  return rows.reverse().map(storedMessageFromRow);
}

async function getStoredChats(device: { id: number; sessionId: string }) {
  await ensureChatAssignmentsSchema();
  const dbChats = (await db
    .select()
    .from(chatsTable)
    .where(eq(chatsTable.deviceId, device.id))) as StoredChatRow[];
  const labelsByChat = await chatLabelsForRows(dbChats.map((chat) => chat.id));
  const assignedUsersById = await assignedUsersForChats(dbChats);

  return dbChats
    .map((chat) => {
      const phoneInfo = phoneInfoFromStoredChat(chat);
      const timestamp = chat.lastMessageAt
        ? Math.floor(chat.lastMessageAt.getTime() / 1000)
        : Math.floor(chat.updatedAt.getTime() / 1000);
      return {
        id: chat.waChatId,
        name: chat.name || chat.waChatId,
        customName: chat.customName ?? null,
        isGroup: chat.isGroup,
        participants: [],
        ...phoneInfo,
        phoneCodeSource: phoneInfo.phoneCodeSource,
        unreadCount: chat.unreadCount,
        timestamp,
        lastMessage: chat.lastMessagePreview || null,
        profilePicUrl: cachedProfilePictureUrl(device.sessionId, chat.waChatId),
        profilePicLookupUrl: profilePictureInfoPath(device.sessionId, chat.waChatId),
        archived: chat.archived,
        favorited: chat.favorited,
        pinned: chat.pinned,
        muted: chat.muted,
        emailNotifications: chat.emailNotifications,
        manuallyUnread: chat.manuallyUnread,
        assignedTo: chatAssignment(chat, assignedUsersById),
        labels: labelsByChat.get(chat.id) ?? [],
      };
    })
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.favorited !== b.favorited) return a.favorited ? -1 : 1;
      return b.timestamp - a.timestamp;
    });
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

router.get("/devices", async (req, res) => {
  const items = (await findDevicesForUser(req.session.userId!)) as DeviceRow[];
  res.json(items.map((d: DeviceRow) => {
    const live = waManager.getState(d.sessionId);
    return { ...d, liveStatus: live?.status ?? d.status };
  }));
});

router.post("/devices", requireAdmin, async (req, res) => {
  const { name } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    return void res.status(400).json({ error: "Name required" });
  }
  const sessionId = crypto.randomBytes(12).toString("hex");
  const [device] = await db
    .insert(devicesTable)
    .values({ userId: req.session.userId!, name: name.trim(), sessionId, status: "disconnected" })
    .returning();
  res.json(device);
});

router.post("/devices/:sessionId/start", requireAdmin, async (req, res) => {
  const device = await ownDevice(req.session.userId!, String(req.params.sessionId));
  if (!device) return void res.status(404).json({ error: "Not found" });
  await waManager.start(device.sessionId);
  res.json({ ok: true });
});

router.post("/devices/:sessionId/logout", requireAdmin, async (req, res) => {
  const device = await ownDevice(req.session.userId!, String(req.params.sessionId));
  if (!device) return void res.status(404).json({ error: "Not found" });
  await waManager.stop(device.sessionId, true);
  await db.update(devicesTable)
    .set({ status: "disconnected", phoneNumber: null, profileName: null })
    .where(eq(devicesTable.id, device.id));
  res.json({ ok: true });
});

router.delete("/devices/:sessionId", requireAdmin, async (req, res) => {
  const device = await ownDevice(req.session.userId!, String(req.params.sessionId));
  if (!device) return void res.status(404).json({ error: "Not found" });
  await waManager.stop(device.sessionId, true);
  await db.delete(devicesTable).where(eq(devicesTable.id, device.id));
  res.json({ ok: true });
});

router.get("/devices/:sessionId/connection-state", async (req, res) => {
  const device = await findDeviceBySessionForUser(req.session.userId!, String(req.params.sessionId));
  if (!device) return void res.status(404).json({ error: "Not found" });
  const state = waManager.getState(device.sessionId);
  res.json({
    sessionId: device.sessionId,
    status: state?.status ?? device.status,
    qr: state?.qrDataUrl ?? null,
    phoneNumber: state?.phoneNumber ?? device.phoneNumber ?? null,
    profileName: state?.profileName ?? device.profileName ?? null,
    error: state?.lastError ?? null,
    metrics: state?.metrics ?? null,
  });
});

router.get("/devices/:sessionId/chats", async (req, res) => {
  const startedAt = Date.now();
  const sessionIdParam = String(req.params.sessionId);
  const device = (await findDeviceBySessionForUser(req.session.userId!, sessionIdParam)) as DeviceRow | null;
  if (!device) return void res.status(404).json({ error: "Not found" });
  await ensureChatAssignmentsSchema();
  ensureDeviceClientRestoring(device);
  const storedChats = await getStoredChats(device);
  if (storedChats.length > 0) {
    res.json(storedChats);
    logSlowOperation(startedAt, "stored chat list response exceeded latency budget", {
      sessionId: device.sessionId,
      chatCount: storedChats.length,
      source: "stored",
    });
    if (waManager.getState(device.sessionId)?.status === "ready") {
      void enqueueWaJob(
        "sync-chats",
        { sessionId: device.sessionId, reason: "stored chats served" },
        { jobId: `sync-chats:${device.sessionId}:${Date.now()}` },
      );
      warmRecentChatMessages(device, storedChats);
    }
    return;
  }

  try {
    const liveChats = (await withTimeout(
      waManager.getChats(device.sessionId),
      LIVE_CHAT_LIST_TIMEOUT_MS,
      "Live WhatsApp chat list timed out",
    )) as LiveChatRow[];

    const dbChats = (await db
      .select()
      .from(chatsTable)
      .where(eq(chatsTable.deviceId, device.id))) as StoredChatRow[];
    const byWaId = new Map(dbChats.map((c) => [c.waChatId, c]));
    const assignedUsersById = await assignedUsersForChats(dbChats);

    const labelRows = dbChats.length
      ? await db
          .select({
            chatId: chatLabelsTable.chatId,
            id: labelsTable.id,
            name: labelsTable.name,
            color: labelsTable.color,
          })
          .from(chatLabelsTable)
          .innerJoin(labelsTable, eq(chatLabelsTable.labelId, labelsTable.id))
          .where(inArray(chatLabelsTable.chatId, dbChats.map((c) => c.id)))
      : [];

    const labelsByChat = new Map<number, { id: number; name: string; color: string }[]>();
    for (const r of labelRows) {
      const list = labelsByChat.get(r.chatId) ?? [];
      list.push({ id: r.id, name: r.name, color: r.color });
      labelsByChat.set(r.chatId, list);
    }

    const merged = liveChats.map((c) => {
      const row = byWaId.get(c.id);
      const labels = row ? labelsByChat.get(row.id) ?? [] : [];
      const unreadCount = Math.max(row?.unreadCount ?? 0, c.unreadCount ?? 0);
      return {
        ...c,
        profilePicUrl: cachedProfilePictureUrl(device.sessionId, c.id) ?? c.profilePicUrl ?? null,
        profilePicLookupUrl: profilePictureInfoPath(device.sessionId, c.id),
        archived: row?.archived ?? false,
        favorited: row?.favorited ?? false,
        pinned: row?.pinned ?? false,
        muted: row?.muted ?? false,
        emailNotifications: row?.emailNotifications ?? true,
        manuallyUnread: row?.manuallyUnread ?? false,
        customName: row?.customName ?? null,
        assignedTo: chatAssignment(row, assignedUsersById),
        unreadCount,
        labels,
      };
    });
    res.json(merged);
    warmRecentChatMessages(device, merged);
    logSlowOperation(startedAt, "live chat list response exceeded latency budget", {
      sessionId: device.sessionId,
      chatCount: merged.length,
      source: "live-empty-cache",
    });
  } catch (err) {
    logger.warn(
      { err, sessionId: device.sessionId, storedChats: storedChats.length },
      "live chat list unavailable; using stored chats",
    );
    res.json(storedChats);
    logSlowOperation(startedAt, "fallback chat list response exceeded latency budget", {
      sessionId: device.sessionId,
      chatCount: storedChats.length,
      source: "fallback",
    });
  }
});

router.get("/devices/:sessionId/chats/:chatId/profile-picture", async (req, res) => {
  const device = await findDeviceBySessionForUser(req.session.userId!, String(req.params.sessionId));
  if (!device) return void res.status(404).json({ error: "Not found" });
  const chatId = String(req.params.chatId);
  const forceRefresh = req.query.refresh === "1";
  const cached = readCachedProfilePicture(device.sessionId, chatId);
  if (cached && !forceRefresh) {
    void enqueueWaJob(
      "refresh-profile-picture",
      { sessionId: device.sessionId, chatId, reason: "cached profile picture served" },
      { jobId: `refresh-profile-picture:${device.sessionId}:${chatId}` },
    );
    return void res.json({ profilePicUrl: profilePictureImagePath(device.sessionId, chatId) });
  }
  try {
    const upstreamUrl = await withTimeout(
      waManager.getProfilePicUrl(device.sessionId, chatId, forceRefresh),
      PROFILE_PIC_LOOKUP_TIMEOUT_MS,
      "Live WhatsApp profile picture lookup timed out",
    );
    res.json({
      profilePicUrl: upstreamUrl || cached ? profilePictureImagePath(device.sessionId, chatId) : null,
    });
  } catch {
    void enqueueWaJob(
      "refresh-profile-picture",
      { sessionId: device.sessionId, chatId, reason: "profile picture lookup fallback" },
      { jobId: `refresh-profile-picture:${device.sessionId}:${chatId}:${Date.now()}` },
    );
    res.json({ profilePicUrl: cached ? profilePictureImagePath(device.sessionId, chatId) : null });
  }
});

router.get("/devices/:sessionId/chats/:chatId/group-participants", async (req, res) => {
  const startedAt = Date.now();
  const device = await findDeviceBySessionForUser(req.session.userId!, String(req.params.sessionId));
  if (!device) return void res.status(404).json({ error: "Not found" });
  const chatId = String(req.params.chatId);
  ensureDeviceClientRestoring(device);

  try {
    const participants = (await withTimeout(
      waManager.getGroupParticipants(device.sessionId, chatId),
      LIVE_CHAT_LIST_TIMEOUT_MS,
      "Live WhatsApp group participants timed out",
    )) as GroupParticipantRow[];
    res.json({ participants, source: "whatsapp" });
    logSlowOperation(startedAt, "group participants response exceeded latency budget", {
      sessionId: device.sessionId,
      chatId,
      participantCount: participants.length,
      source: "whatsapp",
    });
  } catch (err) {
    logger.warn({ err, sessionId: device.sessionId, chatId }, "live WhatsApp group participants unavailable");
    res.json({ participants: [], source: "unavailable" });
  }
});

router.get("/devices/:sessionId/chats/:chatId/profile-picture/image", async (req, res) => {
  const device = await findDeviceBySessionForUser(req.session.userId!, String(req.params.sessionId));
  if (!device) return void res.status(404).json({ error: "Not found" });
  const chatId = String(req.params.chatId);
  const forceRefresh = req.query.refresh === "1";
  const cached = readCachedProfilePicture(device.sessionId, chatId);
  if (cached && !forceRefresh && Date.now() - cached.updatedAt < PROFILE_PIC_CACHE_MAX_AGE_MS) {
    return void sendCachedProfilePicture(res, cached);
  }

  try {
    let upstreamUrl = await withTimeout(
      waManager.getProfilePicUrl(device.sessionId, chatId, forceRefresh),
      PROFILE_PIC_LOOKUP_TIMEOUT_MS,
      "Live WhatsApp profile picture lookup timed out",
    );
    if (!upstreamUrl) {
      if (cached) return void sendCachedProfilePicture(res, cached);
      return void res.status(404).end();
    }

    let upstream = await fetchProfilePicture(upstreamUrl);
    if (!upstream.ok && !forceRefresh) {
      upstreamUrl = await withTimeout(
        waManager.getProfilePicUrl(device.sessionId, chatId, true),
        PROFILE_PIC_LOOKUP_TIMEOUT_MS,
        "Live WhatsApp profile picture refresh timed out",
      );
      upstream = upstreamUrl ? await fetchProfilePicture(upstreamUrl) : upstream;
    }
    if (!upstream.ok) {
      if (cached) return void sendCachedProfilePicture(res, cached);
      return void res.status(404).end();
    }

    const contentType = cleanImageContentType(upstream.headers.get("content-type"));
    const bytes = Buffer.from(await upstream.arrayBuffer());
    writeCachedProfilePicture(device.sessionId, chatId, bytes, contentType);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=900");
    res.send(bytes);
  } catch (err) {
    if (cached) return void sendCachedProfilePicture(res, cached);
    res.status(404).end();
  }
});

router.get("/devices/:sessionId/chats/:chatId/messages", async (req, res) => {
  const startedAt = Date.now();
  const sessionIdParam = String(req.params.sessionId);
  const chatId = String(req.params.chatId);
  const device = (await findDeviceBySessionForUser(req.session.userId!, sessionIdParam)) as DeviceRow | null;
  if (!device) return void res.status(404).json({ error: "Not found" });
  ensureDeviceClientRestoring(device);
  const limit = Math.min(200, Number(req.query.limit) || 50);
  const storedMessages = await getStoredMessages(device.id, chatId, limit);
  if (storedMessages.length > 0) {
    res.setHeader("X-CRM-Messages-Source", "stored");
    res.setHeader("X-CRM-Messages-Syncing", "1");
    res.json(storedMessages);
    logSlowOperation(startedAt, "stored messages response exceeded latency budget", {
      sessionId: device.sessionId,
      chatId,
      messageCount: storedMessages.length,
      source: "stored",
    });
    refreshMessagesInBackground(device, chatId, limit, "stored-messages-served", { downloadMedia: true });
    return;
  }
  res.setHeader("X-CRM-Messages-Source", "empty-cache");
  res.setHeader("X-CRM-Messages-Syncing", "1");
  res.json([]);
  refreshMessagesInBackground(device, chatId, limit, "empty-cache-served", { downloadMedia: true });
  logSlowOperation(startedAt, "empty-cache messages response exceeded latency budget", {
    sessionId: device.sessionId,
    chatId,
    messageCount: 0,
    source: "empty-cache",
  });
});

router.post("/devices/:sessionId/messages/snapshots", async (req, res) => {
  const startedAt = Date.now();
  const sessionIdParam = String(req.params.sessionId);
  const device = (await findDeviceBySessionForUser(req.session.userId!, sessionIdParam)) as DeviceRow | null;
  if (!device) return void res.status(404).json({ error: "Not found" });
  const rawChatIds: unknown[] = Array.isArray(req.body?.chatIds) ? req.body.chatIds : [];
  const chatIds = Array.from(
    new Set(
      rawChatIds
        .filter((chatId): chatId is string => typeof chatId === "string" && !!chatId.trim())
        .map((chatId: string) => chatId.trim().slice(0, 256)),
    ),
  ).slice(0, 40);
  const limit = Math.min(100, Math.max(1, Number(req.body?.limit) || 50));
  const snapshots: Record<string, Awaited<ReturnType<typeof getStoredMessages>>> = {};
  await Promise.all(
    chatIds.map(async (chatId) => {
      snapshots[chatId] = await getStoredMessages(device.id, chatId, limit);
    }),
  );
  res.json(snapshots);
  logSlowOperation(startedAt, "message snapshots response exceeded latency budget", {
    sessionId: device.sessionId,
    chatCount: chatIds.length,
    source: "stored-snapshots",
  });
});

router.post("/devices/:sessionId/chats/:chatId/messages", async (req, res) => {
  if (!(await requirePermission(req, res, "canReply"))) return;
  const device = await findDeviceBySessionForUser(req.session.userId!, String(req.params.sessionId));
  if (!device) return void res.status(404).json({ error: "Not found" });
  const chatId = String(req.params.chatId);
  const { body, quotedMessageId } = req.body ?? {};
  if (typeof body !== "string" || !body.trim()) {
    return void res.status(400).json({ error: "Message body required" });
  }
  if (containsBlockedPhoneNumber(body)) {
    return void res.status(400).json({ error: blockedPhoneNumberMessage });
  }
  try {
    const msg = await waManager.sendMessage(
      device.sessionId,
      chatId,
      body,
      typeof quotedMessageId === "string" && quotedMessageId.trim() ? quotedMessageId.trim() : undefined,
    );
    res.json(msg);
  } catch (err) {
    res.status(409).json({ error: (err as Error).message });
  }
});

function cleanRequiredString(value: unknown, field: string, maxLength = 400) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} requerido`);
  }
  return value.trim().slice(0, maxLength);
}

async function deviceForMessageAction(userId: number, sessionId: string) {
  return findDeviceBySessionForUser(userId, sessionId);
}

router.post("/devices/:sessionId/messages/info", async (req, res) => {
  const device = await deviceForMessageAction(req.session.userId!, String(req.params.sessionId));
  if (!device) return void res.status(404).json({ error: "Not found" });
  try {
    const messageId = cleanRequiredString(req.body?.messageId, "messageId", 512);
    res.json(await waManager.getMessageInfo(device.sessionId, messageId));
  } catch (err) {
    res.status(409).json({ error: (err as Error).message });
  }
});

router.post("/devices/:sessionId/messages/react", async (req, res) => {
  if (!(await requirePermission(req, res, "canReply"))) return;
  const device = await deviceForMessageAction(req.session.userId!, String(req.params.sessionId));
  if (!device) return void res.status(404).json({ error: "Not found" });
  try {
    const messageId = cleanRequiredString(req.body?.messageId, "messageId", 512);
    const reaction = typeof req.body?.reaction === "string" ? req.body.reaction.trim().slice(0, 16) : "";
    if (!reaction) return void res.status(400).json({ error: "Reacción requerida" });
    res.json(await waManager.reactToMessage(device.sessionId, messageId, reaction));
  } catch (err) {
    res.status(409).json({ error: (err as Error).message });
  }
});

router.post("/devices/:sessionId/messages/forward", async (req, res) => {
  if (!(await requirePermission(req, res, "canReply"))) return;
  const device = await deviceForMessageAction(req.session.userId!, String(req.params.sessionId));
  if (!device) return void res.status(404).json({ error: "Not found" });
  try {
    const messageId = cleanRequiredString(req.body?.messageId, "messageId", 512);
    const targetChatId = cleanRequiredString(req.body?.targetChatId, "targetChatId", 256);
    res.json(await waManager.forwardMessage(device.sessionId, messageId, targetChatId));
  } catch (err) {
    res.status(409).json({ error: (err as Error).message });
  }
});

router.post("/devices/:sessionId/messages/download", async (req, res) => {
  const device = await deviceForMessageAction(req.session.userId!, String(req.params.sessionId));
  if (!device) return void res.status(404).json({ error: "Not found" });
  try {
    const messageId = cleanRequiredString(req.body?.messageId, "messageId", 512);
    res.json(await waManager.downloadMessageMedia(device.sessionId, messageId));
  } catch (err) {
    res.status(409).json({ error: (err as Error).message });
  }
});

router.post("/devices/:sessionId/messages/star", async (req, res) => {
  if (!(await requirePermission(req, res, "canManageChats"))) return;
  const device = await deviceForMessageAction(req.session.userId!, String(req.params.sessionId));
  if (!device) return void res.status(404).json({ error: "Not found" });
  try {
    const messageId = cleanRequiredString(req.body?.messageId, "messageId", 512);
    const starred = req.body?.starred !== false;
    res.json(await waManager.starMessage(device.sessionId, messageId, starred));
  } catch (err) {
    res.status(409).json({ error: (err as Error).message });
  }
});

router.post("/devices/:sessionId/messages/pin", async (req, res) => {
  if (!(await requirePermission(req, res, "canManageChats"))) return;
  const device = await deviceForMessageAction(req.session.userId!, String(req.params.sessionId));
  if (!device) return void res.status(404).json({ error: "Not found" });
  try {
    const messageId = cleanRequiredString(req.body?.messageId, "messageId", 512);
    const pinned = req.body?.pinned !== false;
    const rawDuration = Number(req.body?.durationSeconds ?? 604800);
    const duration = Number.isFinite(rawDuration)
      ? Math.max(86400, Math.min(2592000, Math.floor(rawDuration)))
      : 604800;
    res.json(await waManager.pinMessage(device.sessionId, messageId, pinned, duration));
  } catch (err) {
    res.status(409).json({ error: (err as Error).message });
  }
});

router.post("/devices/:sessionId/messages/delete", async (req, res) => {
  if (!(await requirePermission(req, res, "canManageChats"))) return;
  const device = await deviceForMessageAction(req.session.userId!, String(req.params.sessionId));
  if (!device) return void res.status(404).json({ error: "Not found" });
  try {
    const messageId = cleanRequiredString(req.body?.messageId, "messageId", 512);
    res.json(await waManager.deleteMessage(device.sessionId, messageId, false));
  } catch (err) {
    res.status(409).json({ error: (err as Error).message });
  }
});

router.post(
  "/devices/:sessionId/chats/:chatId/media",
  uploadChatMedia.array("files", 10),
  async (req, res) => {
    const files = (req.files as Express.Multer.File[]) || [];
    const cleanupFiles = () => files.forEach((file) => fs.rm(file.path, () => {}));
    if (!(await requirePermission(req, res, "canSendMedia"))) {
      cleanupFiles();
      return;
    }
    const sessionIdParam = String(req.params.sessionId);
    const device = await findDeviceBySessionForUser(req.session.userId!, sessionIdParam);
    const chatId = String(req.params.chatId);
    if (!device) {
      cleanupFiles();
      return void res.status(404).json({ error: "Not found" });
    }
    if (files.length === 0) {
      return void res.status(400).json({ error: "Files required" });
    }

    const caption =
      typeof req.body?.caption === "string" ? req.body.caption.trim().slice(0, 4000) : "";
    const asVoice = req.body?.asVoice === true || req.body?.asVoice === "true";
    if (caption && containsBlockedPhoneNumber(caption)) {
      cleanupFiles();
      return void res.status(400).json({ error: blockedPhoneNumberMessage });
    }

    try {
      const sent: unknown[] = [];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const message = await waManager.sendMedia(
          device.sessionId,
          chatId,
          file.path,
          file.mimetype,
          file.originalname,
          index === 0 && caption ? caption : undefined,
          asVoice && files.length === 1,
        );
        const sentMessage = message as Record<string, unknown>;
        const persistedMediaUrl =
          typeof sentMessage.mediaUrl === "string" && sentMessage.mediaUrl
            ? sentMessage.mediaUrl
            : null;
        if (persistedMediaUrl) {
          fs.rm(file.path, () => {});
        }
        sent.push({
          ...sentMessage,
          hasMedia: true,
          mediaUrl: persistedMediaUrl ?? publicUrlFor(file.path),
          mediaMimeType: file.mimetype,
          mediaFileName: file.originalname,
        });
      }
      res.json({ ok: true, sent });
    } catch (err) {
      cleanupFiles();
      res.status(409).json({ error: (err as Error).message });
    }
  },
);

export default router;
