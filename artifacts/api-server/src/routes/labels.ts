import { Router, type IRouter } from "express";
import { and, count, eq } from "drizzle-orm";
import {
  db,
  labelsTable,
  chatLabelsTable,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { ensureChat, findDeviceBySessionForUser, workspaceOwnerUserId } from "../lib/chats";
import { requirePermission } from "../lib/permissions";

const router: IRouter = Router();
router.use(requireAuth);

const MAX_LABELS_PER_USER = 20;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

router.get("/labels", async (req, res) => {
  const ownerUserId = await workspaceOwnerUserId(req.session.userId!);
  const rows = await db
    .select()
    .from(labelsTable)
    .where(eq(labelsTable.userId, ownerUserId))
    .orderBy(labelsTable.createdAt);
  res.json(rows);
});

router.post("/labels", async (req, res) => {
  if (!(await requirePermission(req, res, "canManageLabels"))) return;
  const ownerUserId = await workspaceOwnerUserId(req.session.userId!);
  const { name, color } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Name required" });
  }
  if (typeof color !== "string" || !COLOR_RE.test(color)) {
    return res.status(400).json({ error: "Color must be #RRGGBB" });
  }
  const cleanName = name.trim().slice(0, 40);
  const [{ value: currentCount }] = await db
    .select({ value: count() })
    .from(labelsTable)
    .where(eq(labelsTable.userId, ownerUserId));
  if (currentCount >= MAX_LABELS_PER_USER) {
    return res.status(409).json({ error: `Max ${MAX_LABELS_PER_USER} labels per user` });
  }
  try {
    const [row] = await db
      .insert(labelsTable)
      .values({ userId: ownerUserId, name: cleanName, color })
      .returning();
    res.json(row);
  } catch (err) {
    const msg = (err as Error).message || "";
    if (msg.includes("labels_user_name_uidx")) {
      return res.status(409).json({ error: "Label name already exists" });
    }
    throw err;
  }
});

router.patch("/labels/:id", async (req, res) => {
  if (!(await requirePermission(req, res, "canManageLabels"))) return;
  const ownerUserId = await workspaceOwnerUserId(req.session.userId!);
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
  const patch: { name?: string; color?: string } = {};
  if (typeof req.body?.name === "string" && req.body.name.trim()) {
    patch.name = req.body.name.trim().slice(0, 40);
  }
  if (typeof req.body?.color === "string") {
    if (!COLOR_RE.test(req.body.color)) {
      return res.status(400).json({ error: "Color must be #RRGGBB" });
    }
    patch.color = req.body.color;
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: "Nothing to update" });
  const [row] = await db
    .update(labelsTable)
    .set(patch)
    .where(and(eq(labelsTable.id, id), eq(labelsTable.userId, ownerUserId)))
    .returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

router.delete("/labels/:id", async (req, res) => {
  if (!(await requirePermission(req, res, "canManageLabels"))) return;
  const ownerUserId = await workspaceOwnerUserId(req.session.userId!);
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
  const [row] = await db
    .delete(labelsTable)
    .where(and(eq(labelsTable.id, id), eq(labelsTable.userId, ownerUserId)))
    .returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

// Attach / detach labels on a chat. Chat is addressed by the WhatsApp chat id
// scoped to one of the user's devices.
async function resolveOwnedChat(userId: number, sessionId: string, waChatId: string, meta?: { name?: string; isGroup?: boolean }) {
  const device = await findDeviceBySessionForUser(userId, sessionId);
  if (!device) return null;
  return ensureChat({ deviceId: device.id, waChatId, ...meta });
}

router.post("/devices/:sessionId/chats/:waChatId/labels/:labelId", async (req, res) => {
  if (!(await requirePermission(req, res, "canManageLabels"))) return;
  const ownerUserId = await workspaceOwnerUserId(req.session.userId!);
  const labelId = Number(req.params.labelId);
  if (!Number.isInteger(labelId)) return res.status(400).json({ error: "Invalid label id" });
  const [label] = await db
    .select()
    .from(labelsTable)
    .where(and(eq(labelsTable.id, labelId), eq(labelsTable.userId, ownerUserId)));
  if (!label) return res.status(404).json({ error: "Label not found" });
  const chat = await resolveOwnedChat(req.session.userId!, req.params.sessionId, req.params.waChatId, {
    name: typeof req.body?.name === "string" ? req.body.name : undefined,
    isGroup: typeof req.body?.isGroup === "boolean" ? req.body.isGroup : undefined,
  });
  if (!chat) return res.status(404).json({ error: "Device not found" });
  try {
    await db.insert(chatLabelsTable).values({ chatId: chat.id, labelId }).onConflictDoNothing();
  } catch (err) {
    /* noop — already attached */
  }
  res.json({ ok: true });
});

router.delete("/devices/:sessionId/chats/:waChatId/labels/:labelId", async (req, res) => {
  if (!(await requirePermission(req, res, "canManageLabels"))) return;
  const ownerUserId = await workspaceOwnerUserId(req.session.userId!);
  const labelId = Number(req.params.labelId);
  if (!Number.isInteger(labelId)) return res.status(400).json({ error: "Invalid label id" });
  const [label] = await db
    .select()
    .from(labelsTable)
    .where(and(eq(labelsTable.id, labelId), eq(labelsTable.userId, ownerUserId)));
  if (!label) return res.status(404).json({ error: "Label not found" });
  const chat = await resolveOwnedChat(req.session.userId!, req.params.sessionId, req.params.waChatId);
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  await db
    .delete(chatLabelsTable)
    .where(and(eq(chatLabelsTable.chatId, chat.id), eq(chatLabelsTable.labelId, labelId)));
  res.json({ ok: true });
});

router.get("/devices/:sessionId/chats/:waChatId/labels", async (req, res) => {
  const ownerUserId = await workspaceOwnerUserId(req.session.userId!);
  const chat = await resolveOwnedChat(req.session.userId!, req.params.sessionId, req.params.waChatId);
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  const rows = await db
    .select({
      id: labelsTable.id,
      name: labelsTable.name,
      color: labelsTable.color,
    })
    .from(chatLabelsTable)
    .innerJoin(labelsTable, eq(chatLabelsTable.labelId, labelsTable.id))
    .where(and(eq(chatLabelsTable.chatId, chat.id), eq(labelsTable.userId, ownerUserId)));
  res.json(rows);
});

export default router;
