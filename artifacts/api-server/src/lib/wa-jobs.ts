import { startWaJobWorker } from "./job-queue";
import { logger } from "./logger";
import { waManager } from "./wa-manager";

export function startWhatsAppJobWorker() {
  return startWaJobWorker(async (job) => {
    const { sessionId, chatId, limit, reason } = job.data;
    switch (job.name) {
      case "recover-device":
        await waManager.recoverSession(sessionId, reason || "queued recovery");
        return;
      case "sync-chats":
        await waManager.getChats(sessionId);
        return;
      case "refresh-messages":
        if (!chatId) return;
        await waManager.getMessages(sessionId, chatId, limit || 50, {
          downloadMedia: job.data.downloadMedia === true,
        });
        return;
      case "refresh-profile-picture":
        if (!chatId) return;
        await waManager.getProfilePicUrl(sessionId, chatId, true);
        return;
      default:
        logger.warn({ jobName: job.name }, "unknown WhatsApp job");
    }
  });
}
