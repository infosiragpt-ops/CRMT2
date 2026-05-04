import express, { type ErrorRequestHandler, type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { requireAuth, sessionMiddleware } from "./lib/auth";
import { setUploadStaticHeaders, UPLOADS_DIR } from "./lib/uploads";
import { corsOptionsForRequest, requireTrustedOrigin } from "./lib/http-security";

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
app.use(cors(corsOptionsForRequest));
app.use(requireTrustedOrigin);
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);

app.use(
  "/uploads",
  requireAuth,
  express.static(UPLOADS_DIR, {
    dotfiles: "deny",
    fallthrough: true,
    index: false,
    maxAge: "7d",
    setHeaders: setUploadStaticHeaders,
  }),
);
app.use("/api", router);

const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  const isMulterError = err?.name === "MulterError" || typeof err?.code === "string" && err.code.startsWith("LIMIT_");
  const rawStatus = Number(err?.status ?? err?.statusCode ?? (isMulterError ? 400 : undefined));
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
