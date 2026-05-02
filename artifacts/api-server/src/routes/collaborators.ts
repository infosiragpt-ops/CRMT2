import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { requireAdmin } from "../lib/auth";
import { normalizePermissions } from "../lib/permissions";

const router: IRouter = Router();

router.use("/collaborators", requireAdmin);

function publicUser(row: typeof usersTable.$inferSelect) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    permissions: normalizePermissions(row.permissions),
    createdAt: row.createdAt,
  };
}

router.get("/collaborators", async (_req, res) => {
  const rows = await db.select().from(usersTable).orderBy(usersTable.createdAt);
  res.json(rows.map(publicUser));
});

router.post("/collaborators", async (req, res) => {
  const { displayName, username, password } = req.body ?? {};
  if (typeof displayName !== "string" || !displayName.trim()) {
    return res.status(400).json({ error: "Nombre requerido" });
  }
  if (typeof username !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username.trim())) {
    return res.status(400).json({ error: "Correo inválido" });
  }
  if (typeof password !== "string" || !/^[A-Za-z0-9]{6}$/.test(password)) {
    return res.status(400).json({ error: "La contraseña debe tener 6 letras o números" });
  }

  const cleanUsername = username.toLowerCase().trim();
  const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.username, cleanUsername));
  if (existing.length) return res.status(409).json({ error: "Ese correo ya tiene acceso" });

  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db
    .insert(usersTable)
    .values({
      username: cleanUsername,
      displayName: displayName.trim().slice(0, 120),
      passwordHash,
      role: "user",
      permissions: normalizePermissions(null),
    })
    .returning();

  res.status(201).json(publicUser(user));
});

router.patch("/collaborators/:id/permissions", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "ID inválido" });

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!existing || existing.role !== "user") {
    return res.status(404).json({ error: "Colaborador no encontrado" });
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
