import { Router, type IRouter } from "express";
import fs from "node:fs";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db, internalMessagesTable, usersTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { ensureInternalMessagesSchema } from "../lib/internal-messages-schema";
import { emitCollaboratorsUpdated, emitInternalMessage, emitInternalRead } from "../lib/internal-message-events";
import { publicUrlFor, uploadChatNoteFile } from "../lib/uploads";

const router: IRouter = Router();
router.use(requireAuth);

type InternalMessageRow = typeof internalMessagesTable.$inferSelect & {
  senderDisplayName: string;
  senderUsername: string;
};

function serializeMessage(row: InternalMessageRow) {
  return {
    id: row.id,
    senderUserId: row.senderUserId,
    recipientUserId: row.recipientUserId,
    body: row.body,
    fileName: row.fileName,
    fileUrl: row.filePath ? publicUrlFor(row.filePath) : null,
    fileMimeType: row.fileMimeType,
    fileSizeBytes: row.fileSizeBytes,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    senderDisplayName: row.senderDisplayName,
    senderUsername: row.senderUsername,
  };
}

const messageFields = {
  id: internalMessagesTable.id,
  senderUserId: internalMessagesTable.senderUserId,
  recipientUserId: internalMessagesTable.recipientUserId,
  body: internalMessagesTable.body,
  fileName: internalMessagesTable.fileName,
  filePath: internalMessagesTable.filePath,
  fileMimeType: internalMessagesTable.fileMimeType,
  fileSizeBytes: internalMessagesTable.fileSizeBytes,
  readAt: internalMessagesTable.readAt,
  createdAt: internalMessagesTable.createdAt,
  senderDisplayName: usersTable.displayName,
  senderUsername: usersTable.username,
};

async function getMessage(id: number) {
  const [row] = await db
    .select(messageFields)
    .from(internalMessagesTable)
    .innerJoin(usersTable, eq(internalMessagesTable.senderUserId, usersTable.id))
    .where(eq(internalMessagesTable.id, id));
  return row ? serializeMessage(row) : null;
}

async function ensurePeer(peerUserId: number) {
  const [peer] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, peerUserId));
  return peer ?? null;
}

async function listConversationMessages(currentUserId: number, peerUserId: number, limit: number) {
  const rows = await db
    .select(messageFields)
    .from(internalMessagesTable)
    .innerJoin(usersTable, eq(internalMessagesTable.senderUserId, usersTable.id))
    .where(
      or(
        and(eq(internalMessagesTable.senderUserId, currentUserId), eq(internalMessagesTable.recipientUserId, peerUserId)),
        and(eq(internalMessagesTable.senderUserId, peerUserId), eq(internalMessagesTable.recipientUserId, currentUserId)),
      ),
    )
    .orderBy(desc(internalMessagesTable.createdAt))
    .limit(limit);

  return rows.reverse().map(serializeMessage);
}

router.get("/team/messages", async (req, res) => {
  await ensureInternalMessagesSchema();
  const currentUserId = req.session.userId!;
  const peerUserId = Number(req.query.with);
  if (!Number.isInteger(peerUserId) || peerUserId <= 0) {
    return void res.status(400).json({ error: "Colaborador inválido" });
  }

  const peer = await ensurePeer(peerUserId);
  if (!peer) return void res.status(404).json({ error: "Colaborador no encontrado" });

  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 200) : 200;
  res.json(await listConversationMessages(currentUserId, peerUserId, limit));
});

router.post("/team/messages/read", async (req, res) => {
  await ensureInternalMessagesSchema();
  const currentUserId = req.session.userId!;
  const peerUserId = Number(req.body?.peerUserId ?? req.body?.with);
  if (!Number.isInteger(peerUserId) || peerUserId <= 0 || peerUserId === currentUserId) {
    return void res.status(400).json({ error: "Colaborador inválido" });
  }

  const peer = await ensurePeer(peerUserId);
  if (!peer) return void res.status(404).json({ error: "Colaborador no encontrado" });

  const readAt = new Date();
  await db
    .update(internalMessagesTable)
    .set({ readAt })
    .where(
      and(
        eq(internalMessagesTable.senderUserId, peerUserId),
        eq(internalMessagesTable.recipientUserId, currentUserId),
        sql`${internalMessagesTable.readAt} IS NULL`,
      ),
    );

  emitInternalRead({ readerUserId: currentUserId, peerUserId, readAt: readAt.toISOString() });
  emitCollaboratorsUpdated({ reason: "internal-read", userIds: [currentUserId, peerUserId] });
  res.json({ ok: true, readAt: readAt.toISOString() });
});

router.post("/team/messages/snapshots", async (req, res) => {
  await ensureInternalMessagesSchema();
  const currentUserId = req.session.userId!;
  const rawIds = Array.isArray(req.body?.peerUserIds) ? req.body.peerUserIds : [];
  const peerUserIds: number[] = Array.from(
    new Set<number>(
      rawIds
        .map((value: unknown) => Number(value))
        .filter((value: number) => Number.isInteger(value) && value > 0 && value !== currentUserId),
    ),
  ).slice(0, 50);
  const rawLimit = Number(req.body?.limit);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100) : 50;

  if (peerUserIds.length === 0) return void res.json({});

  const peers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(inArray(usersTable.id, peerUserIds));

  const snapshots: Record<string, ReturnType<typeof serializeMessage>[]> = {};
  await Promise.all(
    peers.map(async (peer) => {
      snapshots[String(peer.id)] = await listConversationMessages(currentUserId, peer.id, limit);
    }),
  );

  res.json(snapshots);
});

router.post("/team/messages", uploadChatNoteFile.single("file"), async (req, res) => {
  await ensureInternalMessagesSchema();
  const currentUserId = req.session.userId!;
  const file = req.file;
  const cleanupFile = () => {
    if (file?.path) fs.rm(file.path, () => {});
  };
  const recipientUserId = Number(req.body?.recipientUserId);
  const cleanBody = (typeof req.body?.body === "string" ? req.body.body : "").trim().slice(0, 4000);

  if (!Number.isInteger(recipientUserId) || recipientUserId <= 0 || recipientUserId === currentUserId) {
    cleanupFile();
    return void res.status(400).json({ error: "Colaborador inválido" });
  }
  if (!cleanBody && !file) {
    cleanupFile();
    return void res.status(400).json({ error: "Mensaje o archivo requerido" });
  }

  const [recipient] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, recipientUserId));
  if (!recipient) {
    cleanupFile();
    return void res.status(404).json({ error: "Colaborador no encontrado" });
  }

  try {
    const [created] = await db
      .insert(internalMessagesTable)
      .values({
        senderUserId: currentUserId,
        recipientUserId,
        body: cleanBody,
        fileName: file ? file.originalname.slice(0, 255) : null,
        filePath: file?.path ?? null,
        fileMimeType: file?.mimetype || null,
        fileSizeBytes: file?.size ?? null,
      })
      .returning({ id: internalMessagesTable.id });
    const message = await getMessage(created.id);
    if (message) {
      emitInternalMessage({
        senderUserId: currentUserId,
        recipientUserId,
        message,
      });
      emitCollaboratorsUpdated({ reason: "internal-message", userIds: [currentUserId, recipientUserId] });
    }
    res.status(201).json(message);
  } catch (err) {
    cleanupFile();
    throw err;
  }
});

export default router;
