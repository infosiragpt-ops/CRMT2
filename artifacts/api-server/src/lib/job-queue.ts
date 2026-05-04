import { Queue, Worker, type Job, type JobsOptions } from "bullmq";
import { logger } from "./logger";

export type WaJobName =
  | "recover-device"
  | "sync-chats"
  | "refresh-messages"
  | "refresh-profile-picture";

export type WaJobData = {
  sessionId: string;
  chatId?: string;
  limit?: number;
  reason?: string;
  downloadMedia?: boolean;
};

const WA_JOB_QUEUE_NAME = "crmt2-wa-jobs";
const redisUrl = process.env.REDIS_URL?.trim();

function redisConnectionFromUrl(value: string) {
  const url = new URL(value);
  const tls = url.protocol === "rediss:" ? {} : undefined;
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname && url.pathname !== "/" ? Number(url.pathname.slice(1)) || 0 : 0,
    tls,
  };
}

const redisConnection = (() => {
  if (!redisUrl) return null;
  try {
    return redisConnectionFromUrl(redisUrl);
  } catch (err) {
    logger.warn({ err }, "Invalid REDIS_URL; WhatsApp job queue disabled");
    return null;
  }
})();

let queue: Queue<WaJobData> | null = null;

export function isWaJobQueueEnabled() {
  return !!redisConnection;
}

function getQueue() {
  if (!redisConnection) return null;
  if (!queue) {
    queue = new Queue<WaJobData>(WA_JOB_QUEUE_NAME, {
      connection: redisConnection,
      skipVersionCheck: true,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2_000 },
        removeOnComplete: { age: 3600, count: 500 },
        removeOnFail: { age: 86_400, count: 1000 },
      },
    });
    queue.on("error", (err) => logger.warn({ err }, "WhatsApp job queue error"));
  }
  return queue;
}

export async function enqueueWaJob(name: WaJobName, data: WaJobData, options: JobsOptions = {}) {
  const target = getQueue();
  if (!target) return false;
  try {
    const safeOptions =
      typeof options.jobId === "string"
        ? { ...options, jobId: options.jobId.replace(/:/g, "_") }
        : options;
    await target.add(name, data, safeOptions);
    return true;
  } catch (err) {
    logger.warn({ err, name, data }, "failed to enqueue WhatsApp job");
    return false;
  }
}

export function startWaJobWorker(processor: (job: Job<WaJobData>) => Promise<void>) {
  if (!redisConnection) {
    logger.info("WhatsApp Redis job queue disabled; REDIS_URL is not configured");
    return null;
  }

  const worker = new Worker<WaJobData>(WA_JOB_QUEUE_NAME, processor, {
    connection: redisConnection,
    skipVersionCheck: true,
    concurrency: 2,
  });
  worker.on("completed", (job) =>
    logger.info({ jobId: job.id, name: job.name }, "WhatsApp job completed"),
  );
  worker.on("failed", (job, err) =>
    logger.warn({ err, jobId: job?.id, name: job?.name }, "WhatsApp job failed"),
  );
  worker.on("error", (err) => logger.warn({ err }, "WhatsApp job worker error"));
  logger.info("WhatsApp Redis job queue worker started");
  return worker;
}
