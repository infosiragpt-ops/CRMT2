import express, { type ErrorRequestHandler, type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { sessionMiddleware } from "./lib/auth";
import { UPLOADS_DIR } from "./lib/uploads";

const app: Express = express();

app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.REPLIT_DEV_DOMAIN || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean)
  .map((o) => (o.startsWith("http") ? o : `https://${o}`));

function isAllowedOrigin(origin: string) {
  if (allowedOrigins.includes(origin)) return true;
  if (process.env.NODE_ENV === "production") return false;

  try {
    const url = new URL(origin);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

app.use(
  cors({
    origin(origin, cb) {
      // Same-origin (no Origin header) or in allowlist
      if (!origin || allowedOrigins.length === 0 || isAllowedOrigin(origin)) {
        return cb(null, true);
      }
      cb(new Error("Origin not allowed"));
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);

app.use("/uploads", express.static(UPLOADS_DIR, { fallthrough: true, maxAge: "7d" }));
app.use("/api", router);

const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  const rawStatus = Number(err?.status ?? err?.statusCode);
  const status = rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500;
  const message =
    status >= 500
      ? "Internal server error"
      : typeof err?.message === "string" && err.message
        ? err.message
        : "Request failed";

  logger.error({ err, method: req.method, path: req.path, status }, "request failed");
  res.status(status).json({ error: message });
};

app.use(errorHandler);

export default app;
