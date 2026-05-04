import type { Request, RequestHandler } from "express";

const LOCAL_DEV_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function configuredOrigins() {
  return (process.env.ALLOWED_ORIGINS || process.env.REPLIT_DEV_DOMAIN || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => (origin.startsWith("http") ? origin : `https://${origin}`));
}

function isLocalDevOrigin(origin: string) {
  if (process.env.NODE_ENV === "production") return false;

  try {
    const url = new URL(origin);
    return LOCAL_DEV_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function requestHost(req: Request) {
  const forwardedHost = req.headers["x-forwarded-host"];
  if (typeof forwardedHost === "string" && forwardedHost.trim()) {
    return forwardedHost.split(",")[0]?.trim();
  }
  return req.headers.host;
}

function requestProtocol(req: Request) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (typeof forwardedProto === "string" && forwardedProto.trim()) {
    return forwardedProto.split(",")[0]?.trim();
  }
  return req.secure || (req.socket as { encrypted?: boolean }).encrypted ? "https" : "http";
}

function isSameRequestOrigin(req: Request, origin: string) {
  const host = requestHost(req);
  if (!host) return false;
  return origin === `${requestProtocol(req)}://${host}`;
}

export function isConfiguredOrLocalOrigin(origin: string) {
  return configuredOrigins().includes(origin) || isLocalDevOrigin(origin);
}

export function isTrustedOrigin(req: Request, origin: string) {
  return isConfiguredOrLocalOrigin(origin) || isSameRequestOrigin(req, origin);
}

export function corsOptionsForRequest(req: Request, cb: (err: Error | null, options?: { origin: boolean; credentials: boolean }) => void) {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || !origin) {
    cb(null, { origin: false, credentials: true });
    return;
  }
  cb(null, { origin: isTrustedOrigin(req, origin), credentials: true });
}

export const requireTrustedOrigin: RequestHandler = (req, res, next) => {
  if (!UNSAFE_METHODS.has(req.method)) return next();

  const origin = req.headers.origin;
  if (typeof origin === "string" && origin) {
    if (isTrustedOrigin(req, origin)) return next();
    res.status(403).json({ error: "Untrusted request origin" });
    return;
  }

  const referer = req.headers.referer;
  if (typeof referer === "string" && referer) {
    try {
      if (isTrustedOrigin(req, new URL(referer).origin)) return next();
    } catch {
      // Fall through to the reject path below.
    }
    res.status(403).json({ error: "Untrusted request origin" });
    return;
  }

  next();
};
