import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

router.post("/auth/register", async (req, res) => {
  const { username, password, displayName } = req.body ?? {};
  if (typeof username !== "string" || typeof password !== "string" || username.length < 3 || password.length < 6) {
    return res.status(400).json({ error: "Username (>=3) and password (>=6) required" });
  }
  const cleanUsername = username.toLowerCase().trim();
  const cleanDisplay = (typeof displayName === "string" && displayName.trim()) || cleanUsername;
  const existing = await db.select().from(usersTable).where(eq(usersTable.username, cleanUsername));
  if (existing.length) return res.status(409).json({ error: "Username already taken" });

  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db
    .insert(usersTable)
    .values({ username: cleanUsername, passwordHash, displayName: cleanDisplay })
    .returning();
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: "Session error" });
    req.session.userId = user.id;
    req.session.save(() => {
      res.json({ id: user.id, username: user.username, displayName: user.displayName });
    });
  });
});

router.post("/auth/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Username and password required" });
  }
  const cleanUsername = username.toLowerCase().trim();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, cleanUsername));
  if (!user) return res.status(401).json({ error: "Invalid credentials" });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: "Session error" });
    req.session.userId = user.id;
    req.session.save(() => {
      res.json({ id: user.id, username: user.username, displayName: user.displayName });
    });
  });
});

router.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

router.get("/auth/me", requireAuth, async (req, res) => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId!));
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  res.json({ id: user.id, username: user.username, displayName: user.displayName });
});

export default router;
