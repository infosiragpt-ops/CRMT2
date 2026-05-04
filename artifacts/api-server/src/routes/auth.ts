import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { ensureBootstrapAdminRole, isBootstrapAdminUsername } from "../lib/bootstrap-admin";
import { normalizePermissions } from "../lib/permissions";

const router: IRouter = Router();

router.post("/auth/register", async (req, res) => {
  if (process.env.ENABLE_PUBLIC_REGISTRATION !== "true") {
    return void res.status(403).json({ error: "Public registration is disabled" });
  }
  const { username, password, displayName } = req.body ?? {};
  if (typeof username !== "string" || typeof password !== "string" || username.length < 3 || password.length < 12) {
    return void res.status(400).json({ error: "Username (>=3) and password (>=12) required" });
  }
  const cleanUsername = username.toLowerCase().trim();
  const cleanDisplay = (typeof displayName === "string" && displayName.trim()) || cleanUsername;
  if (isBootstrapAdminUsername(cleanUsername)) {
    return void res.status(403).json({ error: "Reserved administrator account" });
  }
  const existing = await db.select().from(usersTable).where(eq(usersTable.username, cleanUsername));
  if (existing.length) return void res.status(409).json({ error: "Username already taken" });

  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db
    .insert(usersTable)
    .values({ username: cleanUsername, passwordHash, displayName: cleanDisplay })
    .returning();
  req.session.regenerate((err) => {
    if (err) return void res.status(500).json({ error: "Session error" });
    req.session.userId = user.id;
    req.session.userRole = user.role as "admin" | "user";
    req.session.save(() => {
      res.json({ id: user.id, username: user.username, displayName: user.displayName, role: user.role, permissions: normalizePermissions(user.permissions) });
    });
  });
});

router.post("/auth/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== "string" || typeof password !== "string") {
    return void res.status(400).json({ error: "Username and password required" });
  }
  const cleanUsername = username.toLowerCase().trim();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, cleanUsername));
  if (!user) return void res.status(401).json({ error: "Invalid credentials" });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return void res.status(401).json({ error: "Invalid credentials" });
  const effectiveUser = await ensureBootstrapAdminRole(user);
  req.session.regenerate((err) => {
    if (err) return void res.status(500).json({ error: "Session error" });
    req.session.userId = effectiveUser.id;
    req.session.userRole = effectiveUser.role as "admin" | "user";
    req.session.save(() => {
      res.json({
        id: effectiveUser.id,
        username: effectiveUser.username,
        displayName: effectiveUser.displayName,
        role: effectiveUser.role,
        permissions: normalizePermissions(effectiveUser.permissions),
      });
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
  if (!user) return void res.status(401).json({ error: "Unauthorized" });
  const effectiveUser = await ensureBootstrapAdminRole(user);
  req.session.userRole = effectiveUser.role as "admin" | "user";
  res.json({
    id: effectiveUser.id,
    username: effectiveUser.username,
    displayName: effectiveUser.displayName,
    role: effectiveUser.role,
    permissions: normalizePermissions(effectiveUser.permissions),
  });
});

export default router;
