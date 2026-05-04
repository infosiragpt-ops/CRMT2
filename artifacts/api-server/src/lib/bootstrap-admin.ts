import bcrypt from "bcryptjs";
import { db, DEFAULT_COLLABORATOR_PERMISSIONS, usersTable, type User } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const DEFAULT_BOOTSTRAP_ADMIN_USERNAME = "admin";

export function getBootstrapAdminUsername() {
  return (process.env.BOOTSTRAP_ADMIN_USERNAME || DEFAULT_BOOTSTRAP_ADMIN_USERNAME).toLowerCase().trim();
}

export function isBootstrapAdminUsername(username: string) {
  return username.toLowerCase().trim() === getBootstrapAdminUsername();
}

async function promoteBootstrapAdmin(user: User) {
  if (user.role === "admin") return user;

  const [updated] = await db
    .update(usersTable)
    .set({
      role: "admin",
      permissions: DEFAULT_COLLABORATOR_PERMISSIONS,
    })
    .where(eq(usersTable.id, user.id))
    .returning();

  logger.warn({ userId: user.id, username: user.username }, "bootstrap admin promoted to admin role");
  return updated ?? user;
}

export async function ensureBootstrapAdminRole(user: User) {
  if (!isBootstrapAdminUsername(user.username)) return user;
  return promoteBootstrapAdmin(user);
}

export async function ensureBootstrapAdmin() {
  const username = getBootstrapAdminUsername();
  if (!username) return null;

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.username, username));
  if (existing) return promoteBootstrapAdmin(existing);

  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;
  if (!password) {
    logger.warn({ username }, "bootstrap admin user does not exist and no bootstrap password was provided");
    return null;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const [created] = await db
    .insert(usersTable)
    .values({
      username,
      passwordHash,
      displayName: process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME || "Administrador",
      role: "admin",
      permissions: DEFAULT_COLLABORATOR_PERMISSIONS,
    })
    .returning();

  logger.warn({ userId: created.id, username: created.username }, "bootstrap admin user created");
  return created;
}
