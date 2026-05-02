import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import type { RequestHandler } from "express";
import { db, pool, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const PgStore = connectPgSimple(session);

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET is required");
}

const isProd = process.env.NODE_ENV === "production";

export const sessionMiddleware: RequestHandler = session({
  store: new PgStore({
    pool,
    createTableIfMissing: true,
    tableName: "user_sessions",
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  proxy: isProd,
  cookie: {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    maxAge: 1000 * 60 * 60 * 24 * 30,
  },
});

declare module "express-session" {
  interface SessionData {
    userId?: number;
    userRole?: "admin" | "user";
  }
}

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

export const requireAdmin: RequestHandler = async (req, res, next) => {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (req.session.userRole === "admin") return next();
  const [u] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.session.userId));
  if (!u || u.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  req.session.userRole = "admin";
  next();
};
