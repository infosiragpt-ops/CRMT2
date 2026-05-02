import { and, desc, eq } from "drizzle-orm";
import { db, chatsTable, devicesTable, usersTable } from "@workspace/db";

export async function ensureChat(params: {
  deviceId: number;
  waChatId: string;
  name?: string;
  isGroup?: boolean;
}) {
  const { deviceId, waChatId } = params;
  const [existing] = await db
    .select()
    .from(chatsTable)
    .where(and(eq(chatsTable.deviceId, deviceId), eq(chatsTable.waChatId, waChatId)));
  if (existing) {
    if (
      (params.name && params.name !== existing.name) ||
      (params.isGroup !== undefined && params.isGroup !== existing.isGroup)
    ) {
      const [updated] = await db
        .update(chatsTable)
        .set({
          name: params.name ?? existing.name,
          isGroup: params.isGroup ?? existing.isGroup,
          updatedAt: new Date(),
        })
        .where(eq(chatsTable.id, existing.id))
        .returning();
      return updated;
    }
    return existing;
  }
  const [created] = await db
    .insert(chatsTable)
    .values({
      deviceId,
      waChatId,
      name: params.name ?? "",
      isGroup: params.isGroup ?? false,
    })
    .returning();
  return created;
}

export async function workspaceOwnerUserId(userId: number) {
  const [user] = await db
    .select({ id: usersTable.id, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!user) return userId;
  if (user.role === "admin") return user.id;

  const [admin] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.role, "admin"))
    .orderBy(usersTable.createdAt);
  return admin?.id ?? user.id;
}

export async function findDevicesForUser(userId: number) {
  const ownerUserId = await workspaceOwnerUserId(userId);
  return db
    .select()
    .from(devicesTable)
    .where(eq(devicesTable.userId, ownerUserId))
    .orderBy(desc(devicesTable.createdAt));
}

export async function findDeviceBySessionForUser(userId: number, sessionId: string) {
  const ownerUserId = await workspaceOwnerUserId(userId);
  const [d] = await db
    .select()
    .from(devicesTable)
    .where(and(eq(devicesTable.sessionId, sessionId), eq(devicesTable.userId, ownerUserId)));
  return d ?? null;
}
