import http from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { attachSocket } from "./lib/socket";
import { db, devicesTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { waManager } from "./lib/wa-manager";

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

const server = http.createServer(app);
attachSocket(server);

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

server.listen(port, () => {
  logger.info({ port }, "Server listening");
  void restoreConnectedDevices();
});
