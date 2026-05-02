import type { Request, Response } from "express";
import { db, DEFAULT_COLLABORATOR_PERMISSIONS, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type CollaboratorPermissionKey = keyof typeof DEFAULT_COLLABORATOR_PERMISSIONS;

export function normalizePermissions(value: unknown) {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    ...DEFAULT_COLLABORATOR_PERMISSIONS,
    ...Object.fromEntries(
      Object.keys(DEFAULT_COLLABORATOR_PERMISSIONS).map((key) => [
        key,
        typeof raw[key] === "boolean"
          ? raw[key]
          : DEFAULT_COLLABORATOR_PERMISSIONS[key as CollaboratorPermissionKey],
      ]),
    ),
  };
}

export async function hasPermission(userId: number, permission: CollaboratorPermissionKey) {
  const [user] = await db
    .select({ role: usersTable.role, permissions: usersTable.permissions })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!user) return false;
  if (user.role === "admin") return true;
  return normalizePermissions(user.permissions)[permission];
}

export async function requirePermission(
  req: Request,
  res: Response,
  permission: CollaboratorPermissionKey,
) {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }

  if (!(await hasPermission(userId, permission))) {
    res.status(403).json({ error: "No tienes permiso para esta acción" });
    return false;
  }

  return true;
}
