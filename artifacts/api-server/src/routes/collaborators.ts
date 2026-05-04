import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { count, eq, sql } from "drizzle-orm";
import { db, internalMessagesTable, usersTable } from "@workspace/db";
import { requireAdmin, requireAuth } from "../lib/auth";
import { ensureChatAssignmentsSchema } from "../lib/chat-assignments-schema";
import { ensureInternalMessagesSchema } from "../lib/internal-messages-schema";
import { normalizePermissions } from "../lib/permissions";
import { isUserOnline } from "../lib/presence";

const router: IRouter = Router();
const DEFAULT_COLLABORATOR_COLOR = "#00a884";

function cleanLabelColor(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : DEFAULT_COLLABORATOR_COLOR;
}

function publicUser(
  row: typeof usersTable.$inferSelect,
  options?: { online?: boolean; unreadInternalCount?: number },
) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    labelColor: row.labelColor || DEFAULT_COLLABORATOR_COLOR,
    permissions: normalizePermissions(row.permissions),
    createdAt: row.createdAt,
    online: !!options?.online,
    unreadInternalCount: options?.unreadInternalCount ?? 0,
  };
}

router.get("/collaborators", requireAuth, async (req, res) => {
  await ensureChatAssignmentsSchema();
  await ensureInternalMessagesSchema();
  const rows = await db.select().from(usersTable).orderBy(usersTable.createdAt);
  const unreadRows = await db
    .select({
      senderUserId: internalMessagesTable.senderUserId,
      value: count(),
    })
    .from(internalMessagesTable)
    .where(
      sql`${internalMessagesTable.recipientUserId} = ${req.session.userId!} AND ${internalMessagesTable.readAt} IS NULL`,
    )
    .groupBy(internalMessagesTable.senderUserId);
  const unreadBySender = new Map(unreadRows.map((row) => [row.senderUserId, Number(row.value)]));
  res.json(
    rows.map((row) =>
      publicUser(row, {
        online: row.id === req.session.userId || isUserOnline(row.id),
        unreadInternalCount: unreadBySender.get(row.id) ?? 0,
      }),
    ),
  );
});

router.post("/collaborators", requireAdmin, async (req, res) => {
  await ensureChatAssignmentsSchema();
  const { displayName, username, password } = req.body ?? {};
  if (typeof displayName !== "string" || !displayName.trim()) {
    return void res.status(400).json({ error: "Nombre requerido" });
  }
  if (typeof username !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username.trim())) {
    return void res.status(400).json({ error: "Correo inválido" });
  }
  if (typeof password !== "string" || !/^[A-Za-z0-9]{6}$/.test(password)) {
    return void res.status(400).json({ error: "La contraseña debe tener 6 letras o números" });
  }

  const cleanUsername = username.toLowerCase().trim();
  const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.username, cleanUsername));
  if (existing.length) return void res.status(409).json({ error: "Ese correo ya tiene acceso" });

  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db
    .insert(usersTable)
    .values({
      username: cleanUsername,
      displayName: displayName.trim().slice(0, 120),
      passwordHash,
      role: "user",
      labelColor: cleanLabelColor(req.body?.labelColor),
      permissions: normalizePermissions(null),
    })
    .returning();

  res.status(201).json(publicUser(user));
});

router.patch("/collaborators/:id/permissions", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return void res.status(400).json({ error: "ID inválido" });

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!existing || existing.role !== "user") {
    return void res.status(404).json({ error: "Colaborador no encontrado" });
  }

  const permissions = normalizePermissions(req.body?.permissions);
  const [updated] = await db
    .update(usersTable)
    .set({ permissions })
    .where(eq(usersTable.id, id))
    .returning();

  res.json(publicUser(updated));
});

export default router;
