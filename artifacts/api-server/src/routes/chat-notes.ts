import { Router, type IRouter } from "express";
import fs from "node:fs";
import { desc, eq } from "drizzle-orm";
import { db, chatNotesTable, usersTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { ensureChat, findDeviceBySessionForUser } from "../lib/chats";
import { publicUrlFor, uploadChatNoteFile } from "../lib/uploads";

const router: IRouter = Router();
router.use(requireAuth);

type NoteRow = {
  id: number;
  body: string;
  fileName: string | null;
  filePath: string | null;
  fileMimeType: string | null;
  fileSizeBytes: number | null;
  createdAt: Date;
  authorDisplayName: string;
  authorUsername: string;
};

function serializeNote(row: NoteRow) {
  return {
    id: row.id,
    body: row.body,
    fileName: row.fileName,
    fileUrl: row.filePath ? publicUrlFor(row.filePath) : null,
    fileMimeType: row.fileMimeType,
    fileSizeBytes: row.fileSizeBytes,
    createdAt: row.createdAt.toISOString(),
    authorDisplayName: row.authorDisplayName,
    authorUsername: row.authorUsername,
  };
}

async function resolveChat(userId: number, sessionId: string, waChatId: string, meta?: { name?: string; isGroup?: boolean }) {
  const device = await findDeviceBySessionForUser(userId, sessionId);
  if (!device) return null;
  return ensureChat({ deviceId: device.id, waChatId, ...meta });
}

async function listNotes(chatId: number) {
  const rows = await db
    .select({
      id: chatNotesTable.id,
      body: chatNotesTable.body,
      fileName: chatNotesTable.fileName,
      filePath: chatNotesTable.filePath,
      fileMimeType: chatNotesTable.fileMimeType,
      fileSizeBytes: chatNotesTable.fileSizeBytes,
      createdAt: chatNotesTable.createdAt,
      authorDisplayName: usersTable.displayName,
      authorUsername: usersTable.username,
    })
    .from(chatNotesTable)
    .innerJoin(usersTable, eq(chatNotesTable.authorUserId, usersTable.id))
    .where(eq(chatNotesTable.chatId, chatId))
    .orderBy(desc(chatNotesTable.createdAt))
    .limit(50);

  return rows.map(serializeNote);
}

async function getNote(noteId: number) {
  const [row] = await db
    .select({
      id: chatNotesTable.id,
      body: chatNotesTable.body,
      fileName: chatNotesTable.fileName,
      filePath: chatNotesTable.filePath,
      fileMimeType: chatNotesTable.fileMimeType,
      fileSizeBytes: chatNotesTable.fileSizeBytes,
      createdAt: chatNotesTable.createdAt,
      authorDisplayName: usersTable.displayName,
      authorUsername: usersTable.username,
    })
    .from(chatNotesTable)
    .innerJoin(usersTable, eq(chatNotesTable.authorUserId, usersTable.id))
    .where(eq(chatNotesTable.id, noteId));
  return row ? serializeNote(row) : null;
}

router.get("/devices/:sessionId/chats/:waChatId/notes", async (req, res) => {
  const chat = await resolveChat(req.session.userId!, req.params.sessionId, req.params.waChatId);
  if (!chat) return void res.status(404).json({ error: "Chat not found" });
  res.json(await listNotes(chat.id));
});

router.post(
  "/devices/:sessionId/chats/:waChatId/notes",
  uploadChatNoteFile.single("file"),
  async (req, res) => {
    const file = req.file;
    const cleanupFile = () => {
      if (file?.path) fs.rm(file.path, () => {});
    };
    const cleanBody = (typeof req.body?.body === "string" ? req.body.body : "").trim().slice(0, 4000);
    if (!cleanBody && !file) {
      return void res.status(400).json({ error: "Nota o archivo requerido" });
    }

    const sessionId = String(req.params.sessionId);
    const waChatId = String(req.params.waChatId);
    const chat = await resolveChat(req.session.userId!, sessionId, waChatId, {
      name: typeof req.body?.name === "string" ? req.body.name : undefined,
      isGroup: req.body?.isGroup === "true" || req.body?.isGroup === true,
    });
    if (!chat) {
      cleanupFile();
      return void res.status(404).json({ error: "Chat not found" });
    }

    try {
      const [created] = await db
        .insert(chatNotesTable)
        .values({
          chatId: chat.id,
          authorUserId: req.session.userId!,
          body: cleanBody,
          fileName: file ? file.originalname.slice(0, 255) : null,
          filePath: file?.path ?? null,
          fileMimeType: file?.mimetype || null,
          fileSizeBytes: file?.size ?? null,
        })
        .returning();

      const serialized = await getNote(created.id);
      res.json(serialized);
    } catch (err) {
      cleanupFile();
      throw err;
    }
  },
);

export default router;
