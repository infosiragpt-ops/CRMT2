import { Router, type IRouter, type Request } from "express";
import fs from "node:fs";
import { and, eq } from "drizzle-orm";
import {
  db,
  quickRepliesTable,
  quickReplyAttachmentsTable,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { uploadQuickReplyMedia, publicUrlFor } from "../lib/uploads";
import { waManager } from "../lib/wa-manager";
import { findDeviceBySessionForUser, ensureChat, workspaceOwnerUserId } from "../lib/chats";
import { blockedPhoneNumberMessage, containsBlockedPhoneNumber } from "../lib/message-security";
import { requirePermission } from "../lib/permissions";

const router: IRouter = Router();
router.use(requireAuth);

function attachmentsFor(quickReplyId: number) {
  return db
    .select()
    .from(quickReplyAttachmentsTable)
    .where(eq(quickReplyAttachmentsTable.quickReplyId, quickReplyId));
}

function attachmentKind(mimetype: string): "image" | "video" | "audio" {
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype.startsWith("audio/")) return "audio";
  return "image";
}

async function serializeReply(reply: typeof quickRepliesTable.$inferSelect) {
  const attachments = await attachmentsFor(reply.id);
  return {
    ...reply,
    attachments: attachments.map((a) => ({
      id: a.id,
      kind: a.kind,
      fileName: a.fileName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      url: publicUrlFor(a.storedPath),
    })),
  };
}

router.get("/quick-replies", async (req, res) => {
  const ownerUserId = await workspaceOwnerUserId(req.session.userId!);
  const rows = await db
    .select()
    .from(quickRepliesTable)
    .where(eq(quickRepliesTable.userId, ownerUserId))
    .orderBy(quickRepliesTable.createdAt);
  const serialized = await Promise.all(rows.map(serializeReply));
  res.json(serialized);
});

router.post(
  "/quick-replies",
  uploadQuickReplyMedia.array("attachments", 10),
  async (req, res) => {
    const files = (req.files as Express.Multer.File[]) || [];
    if (!(await requirePermission(req, res, "canManageQuickReplies"))) {
      files.forEach((f) => fs.rm(f.path, () => {}));
      return;
    }
    const { shortcut, title, body } = req.body ?? {};
    if (typeof shortcut !== "string" || !shortcut.trim()) {
      files.forEach((f) => fs.rm(f.path, () => {}));
      return res.status(400).json({ error: "Shortcut required" });
    }
    const cleanShortcut = shortcut.trim().slice(0, 40);
    const cleanTitle = (typeof title === "string" ? title : "").trim().slice(0, 80);
    const cleanBody = (typeof body === "string" ? body : "").slice(0, 4000);
    const ownerUserId = await workspaceOwnerUserId(req.session.userId!);
    try {
      const [reply] = await db
        .insert(quickRepliesTable)
        .values({
          userId: ownerUserId,
          shortcut: cleanShortcut,
          title: cleanTitle,
          body: cleanBody,
        })
        .returning();
      if (files.length) {
        await db.insert(quickReplyAttachmentsTable).values(
          files.map((f) => ({
            quickReplyId: reply.id,
            kind: attachmentKind(f.mimetype),
            fileName: f.originalname.slice(0, 255),
            storedPath: f.path,
            mimeType: f.mimetype,
            sizeBytes: f.size,
          })),
        );
      }
      res.json(await serializeReply(reply));
    } catch (err) {
      files.forEach((f) => fs.rm(f.path, () => {}));
      const msg = (err as Error).message || "";
      if (msg.includes("quick_replies_user_shortcut_uidx")) {
        return res.status(409).json({ error: "Shortcut already used" });
      }
      throw err;
    }
  },
);

router.patch("/quick-replies/:id", async (req, res) => {
  if (!(await requirePermission(req, res, "canManageQuickReplies"))) return;
  const ownerUserId = await workspaceOwnerUserId(req.session.userId!);
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
  const patch: Partial<typeof quickRepliesTable.$inferInsert> & { updatedAt?: Date } = {
    updatedAt: new Date(),
  };
  if (typeof req.body?.shortcut === "string" && req.body.shortcut.trim()) {
    patch.shortcut = req.body.shortcut.trim().slice(0, 40);
  }
  if (typeof req.body?.title === "string") patch.title = req.body.title.trim().slice(0, 80);
  if (typeof req.body?.body === "string") patch.body = req.body.body.slice(0, 4000);
  const [row] = await db
    .update(quickRepliesTable)
    .set(patch)
    .where(and(eq(quickRepliesTable.id, id), eq(quickRepliesTable.userId, ownerUserId)))
    .returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(await serializeReply(row));
});

router.post(
  "/quick-replies/:id/attachments",
  uploadQuickReplyMedia.array("attachments", 10),
  async (req, res) => {
    const id = Number(req.params.id);
    const files = (req.files as Express.Multer.File[]) || [];
    if (!(await requirePermission(req, res, "canManageQuickReplies"))) {
      files.forEach((f) => fs.rm(f.path, () => {}));
      return;
    }
    const ownerUserId = await workspaceOwnerUserId(req.session.userId!);
    if (!Number.isInteger(id)) {
      files.forEach((f) => fs.rm(f.path, () => {}));
      return res.status(400).json({ error: "Invalid id" });
    }
    const [owned] = await db
      .select()
      .from(quickRepliesTable)
      .where(and(eq(quickRepliesTable.id, id), eq(quickRepliesTable.userId, ownerUserId)));
    if (!owned) {
      files.forEach((f) => fs.rm(f.path, () => {}));
      return res.status(404).json({ error: "Not found" });
    }
    if (files.length) {
      await db.insert(quickReplyAttachmentsTable).values(
        files.map((f) => ({
          quickReplyId: id,
          kind: attachmentKind(f.mimetype),
          fileName: f.originalname.slice(0, 255),
          storedPath: f.path,
          mimeType: f.mimetype,
          sizeBytes: f.size,
        })),
      );
    }
    res.json(await serializeReply(owned));
  },
);

router.delete("/quick-replies/:id/attachments/:attachmentId", async (req, res) => {
  if (!(await requirePermission(req, res, "canManageQuickReplies"))) return;
  const ownerUserId = await workspaceOwnerUserId(req.session.userId!);
  const id = Number(req.params.id);
  const attachmentId = Number(req.params.attachmentId);
  if (!Number.isInteger(id) || !Number.isInteger(attachmentId)) {
    return res.status(400).json({ error: "Invalid id" });
  }
  const [owned] = await db
    .select()
    .from(quickRepliesTable)
    .where(and(eq(quickRepliesTable.id, id), eq(quickRepliesTable.userId, ownerUserId)));
  if (!owned) return res.status(404).json({ error: "Not found" });
  const [att] = await db
    .select()
    .from(quickReplyAttachmentsTable)
    .where(
      and(
        eq(quickReplyAttachmentsTable.id, attachmentId),
        eq(quickReplyAttachmentsTable.quickReplyId, id),
      ),
    );
  if (!att) return res.status(404).json({ error: "Attachment not found" });
  await db.delete(quickReplyAttachmentsTable).where(eq(quickReplyAttachmentsTable.id, attachmentId));
  fs.rm(att.storedPath, () => {});
  res.json({ ok: true });
});

router.delete("/quick-replies/:id", async (req, res) => {
  if (!(await requirePermission(req, res, "canManageQuickReplies"))) return;
  const ownerUserId = await workspaceOwnerUserId(req.session.userId!);
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
  const [owned] = await db
    .select()
    .from(quickRepliesTable)
    .where(and(eq(quickRepliesTable.id, id), eq(quickRepliesTable.userId, ownerUserId)));
  if (!owned) return res.status(404).json({ error: "Not found" });
  const attachments = await attachmentsFor(id);
  await db.delete(quickRepliesTable).where(eq(quickRepliesTable.id, id));
  attachments.forEach((a) => fs.rm(a.storedPath, () => {}));
  res.json({ ok: true });
});

// Send a quick reply into a specific chat. If the reply has attachments, each
// is sent as a media message; the body (if any) rides with the first attachment
// as caption, or as a standalone text if there are no attachments.
router.post(
  "/devices/:sessionId/chats/:waChatId/quick-reply/:id",
  async (req: Request, res) => {
    if (!(await requirePermission(req, res, "canUseQuickReplies"))) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
    const ownerUserId = await workspaceOwnerUserId(req.session.userId!);
    const device = await findDeviceBySessionForUser(req.session.userId!, req.params.sessionId);
    if (!device) return res.status(404).json({ error: "Device not found" });
    const [reply] = await db
      .select()
      .from(quickRepliesTable)
      .where(and(eq(quickRepliesTable.id, id), eq(quickRepliesTable.userId, ownerUserId)));
    if (!reply) return res.status(404).json({ error: "Reply not found" });
    if (containsBlockedPhoneNumber(reply.body)) {
      return res.status(400).json({ error: blockedPhoneNumberMessage });
    }
    const attachments = await attachmentsFor(reply.id);
    await ensureChat({ deviceId: device.id, waChatId: req.params.waChatId });

    try {
      const results: unknown[] = [];
      if (attachments.length === 0) {
        if (reply.body.trim()) {
          results.push(
            await waManager.sendMessage(device.sessionId, req.params.waChatId, reply.body),
          );
        }
      } else {
        for (let i = 0; i < attachments.length; i++) {
          const a = attachments[i];
          const caption = i === 0 ? reply.body : undefined;
          results.push(
            await waManager.sendMedia(
              device.sessionId,
              req.params.waChatId,
              a.storedPath,
              a.mimeType,
              a.fileName,
              caption,
            ),
          );
        }
      }
      res.json({ ok: true, sent: results });
    } catch (err) {
      res.status(409).json({ error: (err as Error).message });
    }
  },
);

export default router;
