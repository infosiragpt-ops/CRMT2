import { Router, type IRouter } from "express";
import fs from "node:fs";
import { and, asc, eq, or, sql } from "drizzle-orm";
import { db, internalMessagesTable, usersTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { ensureInternalMessagesSchema } from "../lib/internal-messages-schema";
import { emitInternalMessage } from "../lib/internal-message-events";
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

async function getMessage(id: number) {
  const [row] = await db
    .select({
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
    })
    .from(internalMessagesTable)
    .innerJoin(usersTable, eq(internalMessagesTable.senderUserId, usersTable.id))
    .where(eq(internalMessagesTable.id, id));
  return row ? serializeMessage(row) : null;
}

router.get("/team/messages", async (req, res) => {
  await ensureInternalMessagesSchema();
  const currentUserId = req.session.userId!;
  const peerUserId = Number(req.query.with);
  if (!Number.isInteger(peerUserId) || peerUserId <= 0) {
    return void res.status(400).json({ error: "Colaborador inválido" });
  }

  const [peer] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, peerUserId));
  if (!peer) return void res.status(404).json({ error: "Colaborador no encontrado" });

  await db
    .update(internalMessagesTable)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(internalMessagesTable.senderUserId, peerUserId),
        eq(internalMessagesTable.recipientUserId, currentUserId),
        sql`${internalMessagesTable.readAt} IS NULL`,
      ),
    );

  const rows = await db
    .select({
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
    })
    .from(internalMessagesTable)
    .innerJoin(usersTable, eq(internalMessagesTable.senderUserId, usersTable.id))
    .where(
      or(
        and(eq(internalMessagesTable.senderUserId, currentUserId), eq(internalMessagesTable.recipientUserId, peerUserId)),
        and(eq(internalMessagesTable.senderUserId, peerUserId), eq(internalMessagesTable.recipientUserId, currentUserId)),
      ),
    )
    .orderBy(asc(internalMessagesTable.createdAt))
    .limit(200);

  res.json(rows.map(serializeMessage));
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
    }
    res.status(201).json(message);
  } catch (err) {
    cleanupFile();
    throw err;
  }
});

export default router;
