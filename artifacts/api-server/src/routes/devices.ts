import { Router, type IRouter } from "express";
import { db, devicesTable } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import crypto from "node:crypto";
import { requireAuth } from "../lib/auth";
import { waManager } from "../lib/wa-manager";

const router: IRouter = Router();

router.use(requireAuth);

async function ownDevice(userId: number, sessionId: string) {
  const [d] = await db
    .select()
    .from(devicesTable)
    .where(and(eq(devicesTable.sessionId, sessionId), eq(devicesTable.userId, userId)));
  return d ?? null;
}

router.get("/devices", async (req, res) => {
  const items = await db
    .select()
    .from(devicesTable)
    .where(eq(devicesTable.userId, req.session.userId!))
    .orderBy(desc(devicesTable.createdAt));
  res.json(items.map((d) => {
    const live = waManager.getState(d.sessionId);
    return { ...d, liveStatus: live?.status ?? d.status };
  }));
});

router.post("/devices", async (req, res) => {
  const { name } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Name required" });
  }
  const sessionId = crypto.randomBytes(12).toString("hex");
  const [device] = await db
    .insert(devicesTable)
    .values({ userId: req.session.userId!, name: name.trim(), sessionId, status: "disconnected" })
    .returning();
  res.json(device);
});

router.post("/devices/:sessionId/start", async (req, res) => {
  const device = await ownDevice(req.session.userId!, req.params.sessionId);
  if (!device) return res.status(404).json({ error: "Not found" });
  await waManager.start(device.sessionId);
  res.json({ ok: true });
});

router.post("/devices/:sessionId/logout", async (req, res) => {
  const device = await ownDevice(req.session.userId!, req.params.sessionId);
  if (!device) return res.status(404).json({ error: "Not found" });
  await waManager.stop(device.sessionId, true);
  await db.update(devicesTable)
    .set({ status: "disconnected", phoneNumber: null, profileName: null })
    .where(eq(devicesTable.id, device.id));
  res.json({ ok: true });
});

router.delete("/devices/:sessionId", async (req, res) => {
  const device = await ownDevice(req.session.userId!, req.params.sessionId);
  if (!device) return res.status(404).json({ error: "Not found" });
  await waManager.stop(device.sessionId, true);
  await db.delete(devicesTable).where(eq(devicesTable.id, device.id));
  res.json({ ok: true });
});

router.get("/devices/:sessionId/chats", async (req, res) => {
  const device = await ownDevice(req.session.userId!, req.params.sessionId);
  if (!device) return res.status(404).json({ error: "Not found" });
  try {
    const chats = await waManager.getChats(device.sessionId);
    res.json(chats);
  } catch (err) {
    res.status(409).json({ error: (err as Error).message });
  }
});

router.get("/devices/:sessionId/chats/:chatId/messages", async (req, res) => {
  const device = await ownDevice(req.session.userId!, req.params.sessionId);
  if (!device) return res.status(404).json({ error: "Not found" });
  const limit = Math.min(200, Number(req.query.limit) || 50);
  try {
    const msgs = await waManager.getMessages(device.sessionId, req.params.chatId, limit);
    res.json(msgs);
  } catch (err) {
    res.status(409).json({ error: (err as Error).message });
  }
});

router.post("/devices/:sessionId/chats/:chatId/messages", async (req, res) => {
  const device = await ownDevice(req.session.userId!, req.params.sessionId);
  if (!device) return res.status(404).json({ error: "Not found" });
  const { body } = req.body ?? {};
  if (typeof body !== "string" || !body.trim()) {
    return res.status(400).json({ error: "Message body required" });
  }
  try {
    const msg = await waManager.sendMessage(device.sessionId, req.params.chatId, body);
    res.json(msg);
  } catch (err) {
    res.status(409).json({ error: (err as Error).message });
  }
});

export default router;
