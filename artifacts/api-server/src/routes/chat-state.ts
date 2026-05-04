import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, chatsTable, usersTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { ensureChat, findDeviceBySessionForUser } from "../lib/chats";
import { ensureChatAssignmentsSchema } from "../lib/chat-assignments-schema";
import { waManager } from "../lib/wa-manager";
import { requirePermission } from "../lib/permissions";

const router: IRouter = Router();
router.use(requireAuth);

router.patch("/devices/:sessionId/chats/:waChatId/state", async (req, res) => {
  if (!(await requirePermission(req, res, "canManageChats"))) return;
  await ensureChatAssignmentsSchema();
  const device = await findDeviceBySessionForUser(req.session.userId!, req.params.sessionId);
  if (!device) return void res.status(404).json({ error: "Device not found" });
  const chat = await ensureChat({
    deviceId: device.id,
    waChatId: req.params.waChatId,
    name: typeof req.body?.name === "string" ? req.body.name : undefined,
    isGroup: typeof req.body?.isGroup === "boolean" ? req.body.isGroup : undefined,
  });

  const patch: Partial<typeof chatsTable.$inferInsert> & { updatedAt?: Date } = { updatedAt: new Date() };
  for (const key of ["archived", "favorited", "pinned", "muted", "emailNotifications", "manuallyUnread"] as const) {
    if (typeof req.body?.[key] === "boolean") patch[key] = req.body[key];
  }
  if (typeof req.body?.customName === "string") {
    const customName = req.body.customName.trim().slice(0, 120);
    patch.customName = customName || null;
  } else if (req.body?.customName === null) {
    patch.customName = null;
  }
  if (req.body?.manuallyUnread === true) {
    // Marking unread: give the badge at least 1
    if (chat.unreadCount === 0) patch.unreadCount = 1;
  }
  if (req.body?.manuallyUnread === false && typeof req.body?.clearUnread === "boolean" && req.body.clearUnread) {
    patch.unreadCount = 0;
  }

  const [updated] = await db
    .update(chatsTable)
    .set(patch)
    .where(eq(chatsTable.id, chat.id))
    .returning();
  res.json(updated);
});

router.patch("/devices/:sessionId/chats/:waChatId/assignment", async (req, res) => {
  if (!(await requirePermission(req, res, "canManageChats"))) return;
  await ensureChatAssignmentsSchema();
  const device = await findDeviceBySessionForUser(req.session.userId!, req.params.sessionId);
  if (!device) return void res.status(404).json({ error: "Device not found" });
  const chat = await ensureChat({
    deviceId: device.id,
    waChatId: req.params.waChatId,
    name: typeof req.body?.name === "string" ? req.body.name : undefined,
    isGroup: typeof req.body?.isGroup === "boolean" ? req.body.isGroup : undefined,
  });

  const assignedUserId =
    req.body?.assignedUserId === null || req.body?.assignedUserId === undefined
      ? null
      : Number(req.body.assignedUserId);
  if (assignedUserId !== null && (!Number.isInteger(assignedUserId) || assignedUserId <= 0)) {
    return void res.status(400).json({ error: "Colaborador inválido" });
  }

  let assignedUser: Pick<typeof usersTable.$inferSelect, "id" | "username" | "displayName" | "labelColor"> | null = null;
  if (assignedUserId !== null) {
    const [user] = await db
      .select({
        id: usersTable.id,
        username: usersTable.username,
        displayName: usersTable.displayName,
        labelColor: usersTable.labelColor,
      })
      .from(usersTable)
      .where(eq(usersTable.id, assignedUserId));
    if (!user) return void res.status(404).json({ error: "Colaborador no encontrado" });
    assignedUser = user;
  }

  const assignedAt = assignedUser ? new Date() : null;
  const [updated] = await db
    .update(chatsTable)
    .set({
      assignedUserId,
      assignedByUserId: assignedUser ? req.session.userId! : null,
      assignedAt,
      updatedAt: new Date(),
    })
    .where(eq(chatsTable.id, chat.id))
    .returning();

  res.json({
    id: updated.id,
    assignedTo: assignedUser
      ? {
          userId: assignedUser.id,
          username: assignedUser.username,
          displayName: assignedUser.displayName,
          color: assignedUser.labelColor || "#00a884",
          assignedByUserId: req.session.userId!,
          assignedAt: assignedAt?.toISOString() ?? new Date().toISOString(),
        }
      : null,
  });
});

router.post("/devices/:sessionId/chats/:waChatId/clear-unread", async (req, res) => {
  const device = await findDeviceBySessionForUser(req.session.userId!, req.params.sessionId);
  if (!device) return void res.status(404).json({ error: "Device not found" });
  const chat = await ensureChat({ deviceId: device.id, waChatId: req.params.waChatId });
  await waManager.markChatSeen(req.params.sessionId, req.params.waChatId).catch(() => false);
  const [updated] = await db
    .update(chatsTable)
    .set({ unreadCount: 0, manuallyUnread: false, updatedAt: new Date() })
    .where(eq(chatsTable.id, chat.id))
    .returning();
  waManager.setActiveChat(req.params.sessionId, req.params.waChatId);
  res.json(updated);
});

// Call when the operator leaves a chat view so incoming messages bump unread again.
router.post("/devices/:sessionId/active-chat", async (req, res) => {
  const device = await findDeviceBySessionForUser(req.session.userId!, req.params.sessionId);
  if (!device) return void res.status(404).json({ error: "Device not found" });
  const waChatId = typeof req.body?.waChatId === "string" && req.body.waChatId ? req.body.waChatId : null;
  waManager.setActiveChat(req.params.sessionId, waChatId);
  res.json({ ok: true });
});

router.delete("/devices/:sessionId/chats/:waChatId", async (_req, res) => {
  res.status(403).json({ error: "No se pueden eliminar conversaciones desde el CRM." });
});

export default router;
