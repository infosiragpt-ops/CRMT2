import http from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { attachSocket } from "./lib/socket";
import { db, devicesTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { waManager } from "./lib/wa-manager";
import { ensureBootstrapAdmin } from "./lib/bootstrap-admin";
import { ensureChatAssignmentsSchema } from "./lib/chat-assignments-schema";
import { ensureQuickRepliesSchema } from "./lib/quick-replies-schema";
import { startWhatsAppJobWorker } from "./lib/wa-jobs";

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

const server = http.createServer(app);
attachSocket(server);

function errorText(reason: unknown) {
  if (reason instanceof Error) return `${reason.name}: ${reason.message}\n${reason.stack ?? ""}`;
  return typeof reason === "string" ? reason : JSON.stringify(reason);
}

function isKnownWhatsAppRuntimeFailure(reason: unknown) {
  const text = errorText(reason).toLowerCase();
  return (
    text.includes("execution context was destroyed") ||
    text.includes("target closed") ||
    text.includes("session closed") ||
    text.includes("navigation") && text.includes("whatsapp-web.js")
  );
}

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled promise rejection");
  if (isKnownWhatsAppRuntimeFailure(reason)) {
    const recovered = waManager.recoverTransientSessions("unhandled WhatsApp runtime rejection");
    logger.warn({ recovered }, "recovered transient WhatsApp runtime rejection");
  }
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "uncaught exception");
  if (isKnownWhatsAppRuntimeFailure(err)) {
    const recovered = waManager.recoverTransientSessions("uncaught WhatsApp runtime exception");
    logger.warn({ recovered }, "recovered transient WhatsApp runtime exception");
    return;
  }
  process.exit(1);
});

async function restoreConnectedDevices() {
  try {
    const devices = await db
      .select({ sessionId: devicesTable.sessionId, status: devicesTable.status })
      .from(devicesTable)
      .where(inArray(devicesTable.status, ["ready", "authenticated"]));

    for (const device of devices) {
      void waManager.start(device.sessionId).catch((err) => {
        logger.warn({ err, sessionId: device.sessionId }, "failed to restore WhatsApp device");
      });
    }
    if (devices.length > 0) {
      logger.info({ count: devices.length }, "restoring WhatsApp devices");
    }
  } catch (err) {
    logger.warn({ err }, "failed to query WhatsApp devices for restore");
  }
}

async function start() {
  await ensureChatAssignmentsSchema();
  await ensureQuickRepliesSchema();
  await ensureBootstrapAdmin();

  server.listen(port, () => {
    logger.info({ port }, "Server listening");
    startWhatsAppJobWorker();
    void restoreConnectedDevices();
  });
}

void start().catch((err) => {
  logger.fatal({ err }, "failed to start server");
  process.exit(1);
});
