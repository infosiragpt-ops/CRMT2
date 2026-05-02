import { Router, type IRouter } from "express";
import {
  db,
  devicesTable,
  chatsTable,
  messagesTable,
  chatLabelsTable,
  labelsTable,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import crypto from "node:crypto";
import fs from "node:fs";
import { requireAdmin, requireAuth } from "../lib/auth";
import { waManager } from "../lib/wa-manager";
import { publicUrlFor, uploadChatMedia } from "../lib/uploads";
import { blockedPhoneNumberMessage, containsBlockedPhoneNumber } from "../lib/message-security";
import { findDeviceBySessionForUser, findDevicesForUser } from "../lib/chats";
import { requirePermission } from "../lib/permissions";

const router: IRouter = Router();

router.use(requireAuth);

type StoredChatRow = {
  id: number;
  waChatId: string;
  name: string;
  isGroup: boolean;
  archived: boolean;
  favorited: boolean;
  pinned: boolean;
  muted: boolean;
  emailNotifications: boolean;
  manuallyUnread: boolean;
  unreadCount: number;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  updatedAt: Date;
};

type LiveChatRow = {
  id: string;
  unreadCount?: number | null;
  profilePicUrl?: string | null;
};

type DeviceRow = {
  id: number;
  sessionId: string;
  status: string;
};

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

function phoneInfoFromWaChatId(chatId: string) {
  const [user, server] = chatId.trim().split("@");
  if (!user || (server !== "c.us" && server !== "s.whatsapp.net")) {
    return { phoneNumber: null, phoneCode: null, phoneCodeVerified: false };
  }
  const digits = user.replace(/\D/g, "");
  if (digits.length < 6) {
    return { phoneNumber: null, phoneCode: null, phoneCodeVerified: false };
  }
  return {
    phoneNumber: digits,
    phoneCode: digits.slice(-6),
    phoneCodeVerified: true,
  };
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
    mediaUrl: row.mediaPath ? publicUrlFor(row.mediaPath) : null,
    mediaMimeType: row.mediaType,
    mediaFileName: fileName,
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
  const dbChats = (await db
    .select()
    .from(chatsTable)
    .where(eq(chatsTable.deviceId, device.id))) as StoredChatRow[];
  const labelsByChat = await chatLabelsForRows(dbChats.map((chat) => chat.id));

  return dbChats
    .map((chat) => {
      const phoneInfo = phoneInfoFromWaChatId(chat.waChatId);
      const timestamp = chat.lastMessageAt
        ? Math.floor(chat.lastMessageAt.getTime() / 1000)
        : Math.floor(chat.updatedAt.getTime() / 1000);
      return {
        id: chat.waChatId,
        name: chat.name || chat.waChatId,
        isGroup: chat.isGroup,
        participants: [],
        ...phoneInfo,
        phoneCodeSource: phoneInfo.phoneCodeVerified ? "whatsapp-id" : null,
        unreadCount: chat.unreadCount,
        timestamp,
        lastMessage: chat.lastMessagePreview || null,
        profilePicUrl: null,
        profilePicLookupUrl: profilePictureInfoPath(device.sessionId, chat.waChatId),
        archived: chat.archived,
        favorited: chat.favorited,
        pinned: chat.pinned,
        muted: chat.muted,
        emailNotifications: chat.emailNotifications,
        manuallyUnread: chat.manuallyUnread,
        labels: labelsByChat.get(chat.id) ?? [],
      };
    })
    .sort((a, b) => b.timestamp - a.timestamp);
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
    return res.status(400).json({ error: "Name required" });
  }
  const sessionId = crypto.randomBytes(12).toString("hex");
  const [device] = await db
    .insert(devicesTable)
    .values({ userId: req.session.userId!, name: name.trim(), sessionId, status: "disconnected" })
    .returning();
  res.json(device);
});

router.post("/devices/:sessionId/start", requireAdmin, async (req, res) => {
  const device = await ownDevice(req.session.userId!, req.params.sessionId);
  if (!device) return res.status(404).json({ error: "Not found" });
  await waManager.start(device.sessionId);
  res.json({ ok: true });
});

router.post("/devices/:sessionId/logout", requireAdmin, async (req, res) => {
  const device = await ownDevice(req.session.userId!, req.params.sessionId);
  if (!device) return res.status(404).json({ error: "Not found" });
  await waManager.stop(device.sessionId, true);
  await db.update(devicesTable)
    .set({ status: "disconnected", phoneNumber: null, profileName: null })
    .where(eq(devicesTable.id, device.id));
  res.json({ ok: true });
});

router.delete("/devices/:sessionId", requireAdmin, async (req, res) => {
  const device = await ownDevice(req.session.userId!, req.params.sessionId);
  if (!device) return res.status(404).json({ error: "Not found" });
  await waManager.stop(device.sessionId, true);
  await db.delete(devicesTable).where(eq(devicesTable.id, device.id));
  res.json({ ok: true });
});

router.get("/devices/:sessionId/chats", async (req, res) => {
  const device = await findDeviceBySessionForUser(req.session.userId!, req.params.sessionId);
  if (!device) return res.status(404).json({ error: "Not found" });
  try {
    const liveChats = (await waManager.getChats(device.sessionId)) as LiveChatRow[];

    const dbChats = (await db
      .select()
      .from(chatsTable)
      .where(eq(chatsTable.deviceId, device.id))) as StoredChatRow[];
    const byWaId = new Map(dbChats.map((c) => [c.waChatId, c]));

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
        profilePicUrl: c.profilePicUrl ?? null,
        profilePicLookupUrl: profilePictureInfoPath(device.sessionId, c.id),
        archived: row?.archived ?? false,
        favorited: row?.favorited ?? false,
        pinned: row?.pinned ?? false,
        muted: row?.muted ?? false,
        emailNotifications: row?.emailNotifications ?? true,
        manuallyUnread: row?.manuallyUnread ?? false,
        unreadCount,
        labels,
      };
    });
    res.json(merged);
  } catch (err) {
    const storedChats = await getStoredChats(device);
    res.json(storedChats);
  }
});

router.get("/devices/:sessionId/chats/:chatId/profile-picture", async (req, res) => {
  const device = await findDeviceBySessionForUser(req.session.userId!, req.params.sessionId);
  if (!device) return res.status(404).json({ error: "Not found" });
  try {
    const chatId = String(req.params.chatId);
    const forceRefresh = req.query.refresh === "1";
    const upstreamUrl = await waManager.getProfilePicUrl(device.sessionId, chatId, forceRefresh);
    res.json({
      profilePicUrl: upstreamUrl ? profilePictureImagePath(device.sessionId, chatId) : null,
    });
  } catch {
    res.json({ profilePicUrl: null });
  }
});

router.get("/devices/:sessionId/chats/:chatId/profile-picture/image", async (req, res) => {
  const device = await findDeviceBySessionForUser(req.session.userId!, req.params.sessionId);
  if (!device) return res.status(404).json({ error: "Not found" });
  const chatId = String(req.params.chatId);
  const forceRefresh = req.query.refresh === "1";

  try {
    let upstreamUrl = await waManager.getProfilePicUrl(device.sessionId, chatId, forceRefresh);
    if (!upstreamUrl) return res.status(404).end();

    let upstream = await fetch(upstreamUrl);
    if (!upstream.ok && !forceRefresh) {
      upstreamUrl = await waManager.getProfilePicUrl(device.sessionId, chatId, true);
      upstream = upstreamUrl ? await fetch(upstreamUrl) : upstream;
    }
    if (!upstream.ok) return res.status(404).end();

    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    const bytes = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=900");
    res.send(bytes);
  } catch (err) {
    res.status(409).json({ error: (err as Error).message });
  }
});

router.get("/devices/:sessionId/chats/:chatId/messages", async (req, res) => {
  const device = await findDeviceBySessionForUser(req.session.userId!, req.params.sessionId);
  if (!device) return res.status(404).json({ error: "Not found" });
  const limit = Math.min(200, Number(req.query.limit) || 50);
  try {
    const msgs = await waManager.getMessages(device.sessionId, req.params.chatId, limit);
    res.json(msgs);
  } catch (err) {
    const msgs = await getStoredMessages(device.id, String(req.params.chatId), limit);
    res.json(msgs);
  }
});

router.post("/devices/:sessionId/chats/:chatId/messages", async (req, res) => {
  if (!(await requirePermission(req, res, "canReply"))) return;
  const device = await findDeviceBySessionForUser(req.session.userId!, String(req.params.sessionId));
  if (!device) return res.status(404).json({ error: "Not found" });
  const chatId = String(req.params.chatId);
  const { body, quotedMessageId } = req.body ?? {};
  if (typeof body !== "string" || !body.trim()) {
    return res.status(400).json({ error: "Message body required" });
  }
  if (containsBlockedPhoneNumber(body)) {
    return res.status(400).json({ error: blockedPhoneNumberMessage });
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
      return res.status(404).json({ error: "Not found" });
    }
    if (files.length === 0) {
      return res.status(400).json({ error: "Files required" });
    }

    const caption =
      typeof req.body?.caption === "string" ? req.body.caption.trim().slice(0, 4000) : "";
    if (caption && containsBlockedPhoneNumber(caption)) {
      cleanupFiles();
      return res.status(400).json({ error: blockedPhoneNumberMessage });
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
        );
        sent.push({
          ...(message as Record<string, unknown>),
          hasMedia: true,
          mediaUrl: publicUrlFor(file.path),
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
