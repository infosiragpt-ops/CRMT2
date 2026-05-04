import path from "node:path";
import fs from "node:fs";
import { accessSync, constants as fsConstants } from "node:fs";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { logger } from "./logger";
import {
  db,
  devicesTable,
  chatsTable,
  messagesTable,
} from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import QRCode from "qrcode";
import { ensureChat } from "./chats";
import { publicUrlFor, UPLOADS_DIR } from "./uploads";
import { maybeRespondWithAgent } from "./openai-agent";
import { enqueueWaJob } from "./job-queue";

// whatsapp-web.js is CJS — load via createRequire so esbuild leaves it alone (it is in externals)
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

type WAClient = {
  initialize: () => Promise<void>;
  destroy: () => Promise<void>;
  logout: () => Promise<void>;
  getChats: () => Promise<unknown[]>;
  getChatById: (id: string) => Promise<unknown>;
  getMessageById?: (id: string) => Promise<unknown>;
  getProfilePicUrl?: (id: string) => Promise<string | undefined>;
  getContactLidAndPhone?: (ids: string[]) => Promise<Array<{ lid?: string; pn?: string }>>;
  sendSeen?: (chatId: string) => Promise<boolean>;
  sendMessage: (chatId: string, content: unknown, options?: unknown) => Promise<unknown>;
  on: (event: string, fn: (...args: any[]) => void) => void;
  info?: { wid: { user: string }; pushname: string };
  pupPage?: {
    evaluate: <T>(fn: (...args: any[]) => T | Promise<T>, ...args: any[]) => Promise<T>;
  };
};

type WAContactLike = {
  id?: unknown;
  name?: string;
  pushname?: string;
  shortName?: string;
  number?: string;
  getProfilePicUrl?: () => Promise<string | undefined>;
};

type WAChatLike = {
  id?: unknown;
  name?: string;
  formattedTitle?: string;
  isGroup?: boolean;
  participants?: Array<{
    id?: unknown;
    name?: string;
    pushname?: string;
    shortName?: string;
    isAdmin?: boolean;
    isSuperAdmin?: boolean;
  }>;
  getContact?: () => Promise<WAContactLike>;
};

type PuppeteerPageLike = {
  mainFrame: () => unknown;
};

type PuppeteerBrowserLike = {
  pages: () => Promise<PuppeteerPageLike[]>;
  newPage?: () => Promise<PuppeteerPageLike>;
};

type PuppeteerModuleLike = {
  launch: (options: unknown) => Promise<PuppeteerBrowserLike>;
  __crmWaPatched?: boolean;
};

type PhoneResolution = {
  phoneNumber: string;
  source: "whatsapp-id" | "lid-resolution" | "contact";
};

const SESSIONS_DIR = process.env.WA_SESSIONS_DIR || path.resolve(process.cwd(), ".wa-sessions");
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

type Listener = (event: string, payload: unknown) => void;

type DownloadedWAMedia = {
  data: string;
  mimetype?: string | null;
  filename?: string | null;
  filesize?: number | null;
};

type SavedMessageMedia = {
  mediaType: string | null;
  mediaPath: string | null;
  fileName: string | null;
};

type PersistMessageOptions = {
  countUnread?: boolean;
  downloadMedia?: boolean;
};

type GetMessagesOptions = {
  downloadMedia?: boolean;
};

interface DeviceState {
  client: WAClient;
  status: "starting" | "qr" | "authenticated" | "ready" | "disconnected" | "auth_failure";
  qrDataUrl?: string;
  phoneNumber?: string;
  profileName?: string;
  deviceRowId?: number;
  activeChatId?: string; // chat the operator currently has open (suppresses unread bump)
  lastError?: string;
  connectionAttemptId?: string;
  connectionStartedAt?: number;
  qrAt?: number;
  authenticatedAt?: number;
  readyAt?: number;
  firstChatsLoadedAt?: number;
  startupWatchdog?: ReturnType<typeof setTimeout>;
  authenticatedWatchdog?: ReturnType<typeof setTimeout>;
}

let resolvedBrowserExecutablePath: string | undefined | null;

function canExecute(filePath: string | undefined | null): filePath is string {
  if (!filePath) return false;
  try {
    accessSync(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findExecutableOnPath(names: string[]) {
  const pathDirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (canExecute(candidate)) return candidate;
    }
  }

  for (const name of names) {
    try {
      const candidate = execFileSync("which", [name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (canExecute(candidate)) return candidate;
    } catch {
      // Continue through the candidate list.
    }
  }
  return null;
}

function resolveBrowserExecutablePath() {
  if (resolvedBrowserExecutablePath !== undefined) return resolvedBrowserExecutablePath ?? undefined;

  const configuredPath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
  if (canExecute(configuredPath)) {
    resolvedBrowserExecutablePath = configuredPath;
    return configuredPath;
  }

  if (configuredPath) {
    logger.warn({ configuredPath }, "configured Chromium path is not executable; falling back to auto-detection");
  }

  const knownPaths = [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/run/current-system/sw/bin/chromium",
    "/nix/var/nix/profiles/default/bin/chromium",
  ];
  const knownPath = knownPaths.find(canExecute);
  if (knownPath) {
    resolvedBrowserExecutablePath = knownPath;
    return knownPath;
  }

  const pathCandidate = findExecutableOnPath(["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]);
  resolvedBrowserExecutablePath = pathCandidate;
  if (!pathCandidate) {
    logger.warn("Chromium executable not found; WhatsApp QR generation will fail until Chromium is available");
  }
  return pathCandidate ?? undefined;
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function requireWhatsappPuppeteer() {
  const whatsappRequire = createRequire(require.resolve("whatsapp-web.js"));
  return whatsappRequire("puppeteer") as PuppeteerModuleLike;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForMainFrame(page: PuppeteerPageLike, timeoutMs = 8_000) {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      page.mainFrame();
      return;
    } catch (err) {
      lastError = err;
      if (!errorMessage(err).includes("main frame")) throw err;
      await delay(75);
    }
  }

  throw lastError ?? new Error("Timed out waiting for Chromium main frame");
}

function patchPuppeteerLaunchForWhatsApp() {
  const puppeteer = requireWhatsappPuppeteer();
  if (puppeteer.__crmWaPatched) return;

  const originalLaunch = puppeteer.launch.bind(puppeteer);
  puppeteer.launch = async (options: unknown) => {
    const browser = await originalLaunch(options);
    const originalPages = browser.pages.bind(browser);

    browser.pages = async () => {
      const pages = await originalPages();
      if (pages[0]) {
        try {
          await waitForMainFrame(pages[0]);
        } catch (err) {
          logger.warn({ err }, "initial Chromium page was not ready quickly; continuing with the existing page");
        }
        return pages;
      }

      if (typeof browser.newPage === "function") {
        const page = await browser.newPage();
        await waitForMainFrame(page);
        return [page, ...pages];
      }

      return pages;
    };

    return browser;
  };

  puppeteer.__crmWaPatched = true;
}

function sanitizeFileName(value: string) {
  return value
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 180) || "archivo";
}

function originalMediaFileName(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 255)
    : null;
}

function extensionForMime(mimeType: string) {
  if (mimeType.includes("jpeg")) return ".jpg";
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("webp")) return ".webp";
  if (mimeType.includes("gif")) return ".gif";
  if (mimeType.includes("pdf")) return ".pdf";
  if (mimeType.includes("wordprocessingml")) return ".docx";
  if (mimeType.includes("spreadsheetml")) return ".xlsx";
  if (mimeType.includes("presentationml")) return ".pptx";
  if (mimeType.includes("msword")) return ".doc";
  if (mimeType.includes("excel")) return ".xls";
  if (mimeType.includes("powerpoint")) return ".ppt";
  if (mimeType.startsWith("audio/")) return ".ogg";
  if (mimeType.startsWith("video/")) return ".mp4";
  return "";
}

function defaultMediaName(payload: ReturnType<typeof serializeMessage>, mimeType: string) {
  const ext = extensionForMime(mimeType);
  if (payload.type === "image" || mimeType.startsWith("image/")) return `imagen-${payload.timestamp}${ext}`;
  if (payload.type === "video" || mimeType.startsWith("video/")) return `video-${payload.timestamp}${ext}`;
  if (payload.type === "audio" || mimeType.startsWith("audio/")) return `audio-${payload.timestamp}${ext}`;
  return `documento-${payload.timestamp}${ext}`;
}

function resolvedMediaFileName(
  media: DownloadedWAMedia | null | undefined,
  payload: ReturnType<typeof serializeMessage>,
  mimeType: string,
) {
  return (
    originalMediaFileName(media?.filename) ||
    originalMediaFileName(payload.mediaFileName) ||
    defaultMediaName(payload, mimeType)
  );
}

function serializedWid(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (!value || typeof value !== "object") return null;
  const serialized = (value as { _serialized?: unknown })._serialized;
  return typeof serialized === "string" && serialized.trim() ? serialized : null;
}

function digitsOnly(value: unknown): string {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

function phoneNumberFromSerializedWid(value: string | null | undefined): string | null {
  if (!value) return null;
  const [user, server] = value.trim().split("@");
  if (!user || !server) return null;
  if (server !== "c.us" && server !== "s.whatsapp.net") return null;
  const digits = digitsOnly(user);
  return digits.length >= 6 ? digits : null;
}

function phoneNumberFromResolvedValue(value: unknown): string | null {
  const serialized = serializedWid(value);
  const fromWid = phoneNumberFromSerializedWid(serialized);
  if (fromWid) return fromWid;
  const digits = digitsOnly(value);
  return digits.length >= 6 ? digits : null;
}

function phoneCodeFromNumber(value: string | null | undefined): string | null {
  const digits = digitsOnly(value);
  return digits.length >= 6 ? digits.slice(-6) : null;
}

function normalizedLid(value: unknown): string | null {
  const raw = serializedWid(value) ?? (typeof value === "string" ? value.trim() : "");
  if (!raw) return null;
  if (raw.endsWith("@lid")) return raw;
  const digits = digitsOnly(raw);
  return digits ? `${digits}@lid` : null;
}

function cleanProfilePicUrl(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function addProfilePicCandidate(candidates: string[], value: string | null | undefined) {
  if (value && !candidates.includes(value)) candidates.push(value);
}

function addPhoneProfilePicCandidates(candidates: string[], value: unknown) {
  const phoneNumber = phoneNumberFromResolvedValue(value);
  if (!phoneNumber) return;
  addProfilePicCandidate(candidates, `${phoneNumber}@c.us`);
  addProfilePicCandidate(candidates, `${phoneNumber}@s.whatsapp.net`);
}

class WAManager {
  private devices = new Map<string, DeviceState>();
  private listeners = new Map<string, Set<Listener>>();
  private recentMessageIds = new Map<string, number>();
  private profilePicCache = new Map<string, { url: string | null; expiresAt: number }>();
  private recoveryAttempts = new Map<string, { count: number; resetAt: number }>();

  private logConnectionMetric(
    sessionId: string,
    state: DeviceState,
    event: string,
    extra: Record<string, unknown> = {},
  ) {
    const now = Date.now();
    logger.info(
      {
        sessionId,
        attemptId: state.connectionAttemptId,
        event,
        status: state.status,
        elapsedMs: state.connectionStartedAt ? now - state.connectionStartedAt : null,
        ...extra,
      },
      "WhatsApp connection metric",
    );
  }

  private clearAuthenticatedWatchdog(state: DeviceState) {
    if (!state.authenticatedWatchdog) return;
    clearTimeout(state.authenticatedWatchdog);
    state.authenticatedWatchdog = undefined;
  }

  private clearStartupWatchdog(state: DeviceState) {
    if (!state.startupWatchdog) return;
    clearTimeout(state.startupWatchdog);
    state.startupWatchdog = undefined;
  }

  private canRecoverSession(sessionId: string) {
    const now = Date.now();
    const current = this.recoveryAttempts.get(sessionId);
    if (!current || current.resetAt <= now) {
      this.recoveryAttempts.set(sessionId, { count: 1, resetAt: now + 10 * 60_000 });
      return true;
    }
    if (current.count >= 2) return false;
    current.count += 1;
    return true;
  }

  private scheduleAuthenticatedWatchdog(sessionId: string, state: DeviceState) {
    this.clearAuthenticatedWatchdog(state);
    state.authenticatedWatchdog = setTimeout(() => {
      const current = this.devices.get(sessionId);
      if (current !== state || current.status !== "authenticated") return;
      const elapsedMs = current.authenticatedAt ? Date.now() - current.authenticatedAt : null;
      this.logConnectionMetric(sessionId, current, "authenticated_stalled", { elapsedSinceAuthenticatedMs: elapsedMs });
      if (!this.canRecoverSession(sessionId)) {
        logger.warn({ sessionId }, "WhatsApp authenticated watchdog reached recovery limit");
        return;
      }
      void enqueueWaJob(
        "recover-device",
        { sessionId, reason: "authenticated watchdog" },
        { jobId: `recover-device:${sessionId}:${Date.now()}` },
      ).then((queued) => {
        if (!queued) {
          void this.recoverSession(sessionId, "authenticated watchdog");
        }
      });
    }, 90_000);
    state.authenticatedWatchdog.unref?.();
  }

  private scheduleStartupWatchdog(sessionId: string, state: DeviceState) {
    this.clearStartupWatchdog(state);
    const timeoutMs = Number(process.env.WA_STARTUP_WATCHDOG_MS || 45_000);
    state.startupWatchdog = setTimeout(() => {
      const current = this.devices.get(sessionId);
      if (current !== state || current.status !== "starting") return;
      this.logConnectionMetric(sessionId, current, "startup_stalled", { timeoutMs });
      if (!this.canRecoverSession(sessionId)) {
        logger.warn({ sessionId }, "WhatsApp startup watchdog reached recovery limit");
        return;
      }
      void enqueueWaJob(
        "recover-device",
        { sessionId, reason: "startup watchdog" },
        { jobId: `recover-device:${sessionId}:${Date.now()}` },
      ).then((queued) => {
        if (!queued) {
          void this.recoverSession(sessionId, "startup watchdog");
        }
      });
    }, timeoutMs);
    state.startupWatchdog.unref?.();
  }

  private async getProfilePicThumbDataUrl(state: DeviceState, candidates: string[]): Promise<string | null> {
    const page = state.client.pupPage;
    if (!page) return null;

    for (const candidate of candidates) {
      try {
        const dataUrl = await page.evaluate(async (contactId: string) => {
          const w = globalThis as {
            fetch: typeof fetch;
            FileReader?: new () => {
              result: string | ArrayBuffer | null;
              onloadend: null | (() => void);
              onerror: null | (() => void);
              readAsDataURL: (blob: Blob) => void;
            };
            Store?: {
              WidFactory?: { createWid?: (id: string) => unknown };
              ProfilePicThumb?: { find?: (wid: unknown) => Promise<{ img?: string } | null> };
            };
          };
          const wid = w.Store?.WidFactory?.createWid?.(contactId);
          if (!wid) return null;
          const profilePicCollection = await w.Store?.ProfilePicThumb?.find?.(wid);
          const imageUrl = profilePicCollection?.img;
          if (!imageUrl) return null;

          const response = await fetch(imageUrl);
          if (!response.ok) return null;
          const imageBlob = await response.blob();
          if (!imageBlob) return null;
          const FileReaderClass = w.FileReader;
          if (!FileReaderClass) return null;

          return await new Promise<string | null>((resolve) => {
            const reader = new FileReaderClass();
            reader.onloadend = () => {
              const result = typeof reader.result === "string" ? reader.result : null;
              resolve(result && result.startsWith("data:image/") ? result : null);
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(imageBlob);
          });
        }, candidate);
        if (cleanProfilePicUrl(dataUrl)) return dataUrl;
      } catch {
        // Try the next candidate. WhatsApp may reject IDs that are valid in other stores.
      }
    }

    return null;
  }

  private async getCachedProfilePicUrl(
    sessionId: string,
    state: DeviceState,
    chatId: string,
    forceRefresh = false,
  ): Promise<string | null> {
    const key = `${sessionId}:${chatId}`;
    const cached = this.profilePicCache.get(key);
    const now = Date.now();
    if (!forceRefresh && cached && cached.expiresAt > now) return cached.url;

    let url: string | null = null;
    try {
      const candidates: string[] = [];
      addProfilePicCandidate(candidates, chatId);

      if (chatId.endsWith("@lid") && typeof state.client.getContactLidAndPhone === "function") {
        const [resolved] = await state.client.getContactLidAndPhone([chatId]);
        addProfilePicCandidate(candidates, resolved?.lid);
        addPhoneProfilePicCandidates(candidates, resolved?.pn);
      }

      const chat = (await state.client.getChatById(chatId)) as WAChatLike;
      if (typeof chat.getContact === "function") {
        const contact = await chat.getContact();
        addProfilePicCandidate(candidates, serializedWid(contact.id));
        addPhoneProfilePicCandidates(candidates, contact.number);
        if (!url && typeof contact.getProfilePicUrl === "function") {
          try {
            url = cleanProfilePicUrl(await contact.getProfilePicUrl());
          } catch {
            url = null;
          }
        }
      }

      if (typeof state.client.getProfilePicUrl === "function") {
        for (const candidate of candidates) {
          if (url) break;
          try {
            url = cleanProfilePicUrl(await state.client.getProfilePicUrl(candidate));
          } catch {
            url = null;
          }
        }
      }

      if (!url) {
        url = await this.getProfilePicThumbDataUrl(state, candidates);
      }
    } catch {
      url = null;
    }

    this.profilePicCache.set(key, { url, expiresAt: now + (url ? 60 * 60_000 : 90_000) });
    if (this.profilePicCache.size > 2000) {
      for (const [cacheKey, value] of this.profilePicCache) {
        if (value.expiresAt <= now || this.profilePicCache.size > 2000) {
          this.profilePicCache.delete(cacheKey);
        }
      }
    }
    return url;
  }

  async getProfilePicUrl(sessionId: string, chatId: string, forceRefresh = false) {
    const s = this.devices.get(sessionId);
    if (!s || s.status !== "ready") throw new Error("Device not ready");
    return this.getCachedProfilePicUrl(sessionId, s, chatId, forceRefresh);
  }

  private rememberMessage(sessionId: string, waMessageId: string | null | undefined): boolean {
    if (!waMessageId) return true;
    const now = Date.now();
    const key = `${sessionId}:${waMessageId}`;
    if (this.recentMessageIds.has(key)) return false;
    this.recentMessageIds.set(key, now);

    if (this.recentMessageIds.size > 3000) {
      const cutoff = now - 10 * 60_000;
      for (const [seenKey, seenAt] of this.recentMessageIds) {
        if (seenAt < cutoff || this.recentMessageIds.size > 3000) {
          this.recentMessageIds.delete(seenKey);
        }
      }
    }
    return true;
  }

  private handleMessageEvent(sessionId: string, state: DeviceState, msg: any) {
    const payload = serializeMessage(msg);
    if (!this.rememberMessage(sessionId, payload.id)) return;
    if (!payload.hasMedia) {
      this.emit(sessionId, "message", payload);
    }
    void this.persistMessage(sessionId, state, msg, payload).then((storedPayload) => {
      if (!storedPayload) return;
      if (storedPayload.hasMedia) {
        this.emit(sessionId, "message", storedPayload);
      }
      if (!storedPayload.fromMe) {
        void maybeRespondWithAgent({
          sessionId,
          message: storedPayload,
          sendMessage: (chatId, body, quotedMessageId) =>
            this.sendMessage(sessionId, chatId, body, quotedMessageId),
        });
      }
    });
  }

  subscribe(sessionId: string, listener: Listener): () => void {
    let set = this.listeners.get(sessionId);
    if (!set) {
      set = new Set();
      this.listeners.set(sessionId, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
    };
  }

  setActiveChat(sessionId: string, waChatId: string | null) {
    const s = this.devices.get(sessionId);
    if (!s) return;
    s.activeChatId = waChatId ?? undefined;
  }

  private emit(sessionId: string, event: string, payload: unknown) {
    const set = this.listeners.get(sessionId);
    if (!set) return;
    for (const l of set) {
      try { l(event, payload); } catch (err) { logger.error({ err }, "listener error"); }
    }
  }

  private emitMessageIfNew(sessionId: string, payload: ReturnType<typeof serializeMessage>) {
    if (this.rememberMessage(sessionId, payload.id)) {
      this.emit(sessionId, "message", payload);
    }
  }

  getState(sessionId: string): (Omit<DeviceState, "client" | "deviceRowId" | "activeChatId" | "startupWatchdog" | "authenticatedWatchdog"> & {
    metrics: {
      attemptId: string | undefined;
      elapsedMs: number | null;
      qrDelayMs: number | null;
      authenticatedDelayMs: number | null;
      readyDelayMs: number | null;
      firstChatsDelayMs: number | null;
    };
  }) | null {
    const s = this.devices.get(sessionId);
    if (!s) return null;
    const now = Date.now();
    return {
      status: s.status,
      qrDataUrl: s.qrDataUrl,
      phoneNumber: s.phoneNumber,
      profileName: s.profileName,
      lastError: s.lastError,
      connectionAttemptId: s.connectionAttemptId,
      connectionStartedAt: s.connectionStartedAt,
      qrAt: s.qrAt,
      authenticatedAt: s.authenticatedAt,
      readyAt: s.readyAt,
      firstChatsLoadedAt: s.firstChatsLoadedAt,
      metrics: {
        attemptId: s.connectionAttemptId,
        elapsedMs: s.connectionStartedAt ? now - s.connectionStartedAt : null,
        qrDelayMs: s.connectionStartedAt && s.qrAt ? s.qrAt - s.connectionStartedAt : null,
        authenticatedDelayMs:
          s.connectionStartedAt && s.authenticatedAt ? s.authenticatedAt - s.connectionStartedAt : null,
        readyDelayMs: s.connectionStartedAt && s.readyAt ? s.readyAt - s.connectionStartedAt : null,
        firstChatsDelayMs:
          s.connectionStartedAt && s.firstChatsLoadedAt ? s.firstChatsLoadedAt - s.connectionStartedAt : null,
      },
    };
  }

  hasClient(sessionId: string): boolean {
    return this.devices.has(sessionId);
  }

  private startPromises = new Map<string, Promise<void>>();

  async start(sessionId: string): Promise<void> {
    const existingStart = this.startPromises.get(sessionId);
    if (existingStart) return existingStart;
    const p = this.doStart(sessionId).finally(() => this.startPromises.delete(sessionId));
    this.startPromises.set(sessionId, p);
    return p;
  }

  async recoverSession(sessionId: string, reason = "manual recovery"): Promise<void> {
    const current = this.devices.get(sessionId);
    if (current) {
      this.clearStartupWatchdog(current);
      this.clearAuthenticatedWatchdog(current);
      logger.warn({ sessionId, reason, status: current.status }, "recovering WhatsApp session");
      try {
        await current.client.destroy();
      } catch (err) {
        logger.warn({ err, sessionId }, "failed to destroy WhatsApp client during recovery");
      }
      this.devices.delete(sessionId);
    }
    await this.start(sessionId);
  }

  recoverTransientSessions(reason = "transient WhatsApp runtime error") {
    let recovered = 0;
    for (const [sessionId, state] of this.devices) {
      if (state.status === "ready" || state.status === "disconnected" || state.status === "auth_failure") continue;
      if (!this.canRecoverSession(sessionId)) {
        logger.warn({ sessionId, reason, status: state.status }, "transient recovery skipped by limit");
        continue;
      }
      recovered += 1;
      void this.recoverSession(sessionId, reason).catch((err) => {
        logger.warn({ err, sessionId, reason }, "transient WhatsApp recovery failed");
      });
    }
    return recovered;
  }

  private async doStart(sessionId: string): Promise<void> {
    if (this.devices.has(sessionId)) {
      const s = this.devices.get(sessionId)!;
      if (s.status === "auth_failure" || s.status === "disconnected") {
        try { await s.client.destroy(); } catch { /* noop */ }
        this.devices.delete(sessionId);
      } else {
        if (s.qrDataUrl) this.emit(sessionId, "qr", { qr: s.qrDataUrl });
        this.emit(sessionId, "status", { status: s.status, error: s.lastError });
        return;
      }
    }

    patchPuppeteerLaunchForWhatsApp();

    const { Client, LocalAuth } = require("whatsapp-web.js") as {
      Client: new (opts: unknown) => WAClient;
      LocalAuth: new (opts: unknown) => unknown;
    };

    const client = new Client({
      authStrategy: new LocalAuth({ clientId: sessionId, dataPath: SESSIONS_DIR }),
      puppeteer: {
        headless: true,
        executablePath: resolveBrowserExecutablePath(),
        timeout: 120_000,
        protocolTimeout: 120_000,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--disable-gpu",
          "--no-first-run",
          "--no-zygote",
          "--disable-extensions",
          "--disable-background-networking",
          "--disable-default-apps",
          "--disable-sync",
        ],
      },
    });

    const state: DeviceState = {
      client,
      status: "starting",
      connectionAttemptId: crypto.randomUUID(),
      connectionStartedAt: Date.now(),
    };
    this.devices.set(sessionId, state);
    this.logConnectionMetric(sessionId, state, "start", { chromiumPath: resolveBrowserExecutablePath() });
    this.scheduleStartupWatchdog(sessionId, state);

    // Cache the DB device row id so message handlers avoid a round-trip per event.
    const [deviceRow] = await db
      .select({ id: devicesTable.id })
      .from(devicesTable)
      .where(eq(devicesTable.sessionId, sessionId));
    state.deviceRowId = deviceRow?.id;

    client.on("qr", async (qr: string) => {
      try {
        this.clearStartupWatchdog(state);
        const dataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 1 });
        state.qrDataUrl = dataUrl;
        state.status = "qr";
        state.qrAt = Date.now();
        state.lastError = undefined;
        this.logConnectionMetric(sessionId, state, "qr");
        this.emit(sessionId, "qr", { qr: dataUrl });
        this.emit(sessionId, "status", { status: "qr" });
        await db.update(devicesTable).set({ status: "qr" }).where(eq(devicesTable.sessionId, sessionId));
      } catch (err) {
        logger.error({ err }, "qr render error");
      }
    });

    client.on("authenticated", async () => {
      this.clearStartupWatchdog(state);
      state.status = "authenticated";
      state.authenticatedAt = Date.now();
      state.qrDataUrl = undefined;
      state.lastError = undefined;
      this.logConnectionMetric(sessionId, state, "authenticated");
      this.emit(sessionId, "status", { status: "authenticated" });
      this.scheduleAuthenticatedWatchdog(sessionId, state);
      await db.update(devicesTable).set({ status: "authenticated" }).where(eq(devicesTable.sessionId, sessionId));
    });

    client.on("auth_failure", async (msg: string) => {
      this.clearStartupWatchdog(state);
      this.clearAuthenticatedWatchdog(state);
      state.status = "auth_failure";
      state.lastError = msg;
      this.logConnectionMetric(sessionId, state, "auth_failure", { error: msg });
      this.emit(sessionId, "status", { status: "auth_failure", error: msg });
      await db.update(devicesTable).set({ status: "auth_failure" }).where(eq(devicesTable.sessionId, sessionId));
    });

    client.on("ready", async () => {
      this.clearStartupWatchdog(state);
      this.clearAuthenticatedWatchdog(state);
      state.status = "ready";
      state.lastError = undefined;
      state.readyAt = Date.now();
      state.phoneNumber = client.info?.wid.user;
      state.profileName = client.info?.pushname;
      this.recoveryAttempts.delete(sessionId);
      this.logConnectionMetric(sessionId, state, "ready", {
        phoneNumber: state.phoneNumber,
        profileName: state.profileName,
        elapsedSinceAuthenticatedMs: state.authenticatedAt ? state.readyAt - state.authenticatedAt : null,
      });
      this.emit(sessionId, "status", { status: "ready", phoneNumber: state.phoneNumber, profileName: state.profileName });
      await db.update(devicesTable).set({
        status: "ready",
        phoneNumber: state.phoneNumber,
        profileName: state.profileName,
        lastConnectedAt: new Date(),
      }).where(eq(devicesTable.sessionId, sessionId));
      void enqueueWaJob(
        "sync-chats",
        { sessionId, reason: "ready" },
        { jobId: `sync-chats:${sessionId}:${Date.now()}` },
      );
    });

    client.on("disconnected", async (reason: string) => {
      this.clearStartupWatchdog(state);
      this.clearAuthenticatedWatchdog(state);
      state.status = "disconnected";
      state.lastError = reason;
      this.logConnectionMetric(sessionId, state, "disconnected", { reason });
      this.emit(sessionId, "status", { status: "disconnected", reason, error: reason });
      await db.update(devicesTable).set({ status: "disconnected" }).where(eq(devicesTable.sessionId, sessionId));
      this.devices.delete(sessionId);
    });

    client.on("message", (msg: any) => {
      this.handleMessageEvent(sessionId, state, msg);
    });

    client.on("message_create", (msg: any) => {
      this.handleMessageEvent(sessionId, state, msg);
    });

    client.initialize().catch((err) => {
      const message = errorMessage(err);
      logger.error({ err, sessionId, chromiumPath: resolveBrowserExecutablePath() }, "WA client initialize failed");
      state.status = "auth_failure";
      state.lastError = message;
      this.clearStartupWatchdog(state);
      this.clearAuthenticatedWatchdog(state);
      this.logConnectionMetric(sessionId, state, "initialize_failed", { error: message });
      this.emit(sessionId, "status", { status: "auth_failure", error: message });
      void db.update(devicesTable).set({ status: "auth_failure" }).where(eq(devicesTable.sessionId, sessionId));
    });
  }

  private async persistMessage(
    sessionId: string,
    state: DeviceState,
    rawMsg: any,
    payload: ReturnType<typeof serializeMessage>,
    downloadedMedia?: DownloadedWAMedia | null,
    options: PersistMessageOptions = {},
  ): Promise<ReturnType<typeof serializeMessage> | null> {
    try {
      if (!state.deviceRowId) {
        const [row] = await db
          .select({ id: devicesTable.id })
          .from(devicesTable)
          .where(eq(devicesTable.sessionId, sessionId));
        if (!row) return null;
        state.deviceRowId = row.id;
      }
      const deviceRowId = state.deviceRowId;
      if (!deviceRowId) return null;
      const waChatId = payload.chatId;
      let chatName = "";
      let isGroup = false;
      try {
        const chat = await rawMsg.getChat?.();
        if (chat) {
          chatName = chat.name || chat.formattedTitle || "";
          isGroup = !!chat.isGroup;
        }
      } catch { /* noop */ }
      const chatRow = await ensureChat({
        deviceId: deviceRowId,
        waChatId,
        name: chatName,
        isGroup,
      });
      const preview = payload.body?.slice(0, 200) || (payload.hasMedia ? `[${payload.type}]` : "");
      const incoming = !payload.fromMe;
      const isActive = state.activeChatId === waChatId;
      const bumpUnread = options.countUnread !== false && incoming && !isActive;
      const [inserted] = await db
        .insert(messagesTable)
        .values({
          chatId: chatRow.id,
          waMessageId: payload.id,
          fromMe: payload.fromMe,
          author: payload.author ?? null,
          body: payload.body,
          type: payload.type,
          hasMedia: payload.hasMedia,
          timestamp: payload.timestamp,
        })
        .onConflictDoNothing()
        .returning({ id: messagesTable.id });

      if (!inserted) {
        const media = payload.hasMedia && options.downloadMedia !== false
          ? await this.saveMessageMedia(sessionId, rawMsg, payload, downloadedMedia)
          : null;

        if (media?.mediaPath || media?.mediaType || media?.fileName) {
          await db
            .update(messagesTable)
            .set({
              mediaType: media.mediaType ?? payload.mediaMimeType ?? null,
              mediaPath: media.mediaPath ?? null,
              raw: media.fileName ? { fileName: media.fileName } : null,
            })
            .where(and(eq(messagesTable.chatId, chatRow.id), eq(messagesTable.waMessageId, payload.id)));
        }

        const [storedPayload] = await this.enrichMessagesFromDb(state, waChatId, [payload]);
        return storedPayload ?? {
          ...payload,
          mediaUrl: media?.mediaPath ? publicUrlFor(media.mediaPath) : payload.mediaUrl,
          mediaMimeType: media?.mediaType ?? payload.mediaMimeType,
          mediaFileName: media?.fileName ?? payload.mediaFileName,
        };
      }

      const media = payload.hasMedia && options.downloadMedia !== false
        ? await this.saveMessageMedia(sessionId, rawMsg, payload, downloadedMedia)
        : null;

      if (media?.mediaPath || media?.mediaType || media?.fileName) {
        await db
          .update(messagesTable)
          .set({
            mediaType: media.mediaType ?? payload.mediaMimeType ?? null,
            mediaPath: media.mediaPath ?? null,
            raw: media.fileName ? { fileName: media.fileName } : null,
          })
          .where(eq(messagesTable.id, inserted.id));
      }

      await db
        .update(chatsTable)
        .set({
          lastMessageAt: new Date(payload.timestamp * 1000),
          lastMessagePreview: preview,
          updatedAt: new Date(),
          ...(bumpUnread
            ? { unreadCount: sql`${chatsTable.unreadCount} + 1` }
            : {}),
        })
        .where(eq(chatsTable.id, chatRow.id));

      return {
        ...payload,
        mediaUrl: media?.mediaPath ? publicUrlFor(media.mediaPath) : payload.mediaUrl,
        mediaMimeType: media?.mediaType ?? payload.mediaMimeType,
        mediaFileName: media?.fileName ?? payload.mediaFileName,
      };
    } catch (err) {
      logger.error({ err, sessionId }, "persistMessage failed");
      return payload;
    }
  }

  private async saveMessageMedia(
    sessionId: string,
    rawMsg: any,
    payload: ReturnType<typeof serializeMessage>,
    downloadedMedia?: DownloadedWAMedia | null,
  ): Promise<SavedMessageMedia | null> {
    if (!payload.hasMedia) return null;
    if (!downloadedMedia && typeof rawMsg.downloadMedia !== "function") return null;
    try {
      const media = downloadedMedia ?? await rawMsg.downloadMedia();
      if (!media?.data) return null;

      const mediaType = (media.mimetype || payload.mediaMimeType || "application/octet-stream") as string;
      const fileName = resolvedMediaFileName(media, payload, mediaType);
      const ext = path.extname(sanitizeFileName(fileName)) || extensionForMime(mediaType);
      const safeSession = sanitizeFileName(sessionId).replace(/\./g, "-");
      const safeMessageId = sanitizeFileName(payload.id).replace(/\./g, "-").slice(0, 90);
      const dir = path.join(UPLOADS_DIR, "wa-media", safeSession);
      await fs.promises.mkdir(dir, { recursive: true });
      const mediaPath = path.join(dir, `${payload.timestamp}-${safeMessageId}${ext}`);
      await fs.promises.writeFile(mediaPath, Buffer.from(media.data, "base64"));

      return { mediaType, mediaPath, fileName };
    } catch (err) {
      logger.warn({ err, sessionId, messageId: payload.id }, "download media failed");
      return null;
    }
  }

  private async enrichMessagesFromDb(
    state: DeviceState,
    waChatId: string,
    payloads: ReturnType<typeof serializeMessage>[],
  ): Promise<ReturnType<typeof serializeMessage>[]> {
    if (!state.deviceRowId || payloads.length === 0) return payloads;
    try {
      const [chatRow] = await db
        .select({ id: chatsTable.id })
        .from(chatsTable)
        .where(and(eq(chatsTable.deviceId, state.deviceRowId), eq(chatsTable.waChatId, waChatId)));
      if (!chatRow) return payloads;

      const ids = payloads.map((payload) => payload.id).filter(Boolean);
      if (ids.length === 0) return payloads;
      type StoredMessageMedia = {
        waMessageId: string;
        mediaType: string | null;
        mediaPath: string | null;
        raw: unknown;
      };
      const rows = (await db
        .select({
          waMessageId: messagesTable.waMessageId,
          mediaType: messagesTable.mediaType,
          mediaPath: messagesTable.mediaPath,
          raw: messagesTable.raw,
        })
        .from(messagesTable)
        .where(and(eq(messagesTable.chatId, chatRow.id), inArray(messagesTable.waMessageId, ids)))) as StoredMessageMedia[];
      const byId = new Map<string, StoredMessageMedia>(rows.map((row) => [row.waMessageId, row]));

      return payloads.map((payload) => {
        const row = byId.get(payload.id);
        const raw = row?.raw as { fileName?: unknown } | null | undefined;
        const storedFileName = typeof raw?.fileName === "string" ? raw.fileName : null;
        return {
          ...payload,
          mediaUrl: row?.mediaPath ? publicUrlFor(row.mediaPath) : payload.mediaUrl,
          mediaMimeType: row?.mediaType ?? payload.mediaMimeType,
          mediaFileName: storedFileName ?? payload.mediaFileName,
        };
      });
    } catch (err) {
      logger.warn({ err, waChatId }, "message media enrichment failed");
      return payloads;
    }
  }

  private async getStoredMessages(
    state: DeviceState,
    waChatId: string,
    limit: number,
  ): Promise<ReturnType<typeof serializeMessage>[]> {
    if (!state.deviceRowId) return [];
    try {
      const [chatRow] = await db
        .select({ id: chatsTable.id })
        .from(chatsTable)
        .where(and(eq(chatsTable.deviceId, state.deviceRowId), eq(chatsTable.waChatId, waChatId)));
      if (!chatRow) return [];
      type StoredMessage = {
        waMessageId: string;
        fromMe: boolean;
        author: string | null;
        body: string;
        type: string;
        hasMedia: boolean;
        mediaType: string | null;
        mediaPath: string | null;
        raw: unknown;
        timestamp: number;
      };
      const rows = (await db
        .select({
          waMessageId: messagesTable.waMessageId,
          fromMe: messagesTable.fromMe,
          author: messagesTable.author,
          body: messagesTable.body,
          type: messagesTable.type,
          hasMedia: messagesTable.hasMedia,
          mediaType: messagesTable.mediaType,
          mediaPath: messagesTable.mediaPath,
          raw: messagesTable.raw,
          timestamp: messagesTable.timestamp,
        })
        .from(messagesTable)
        .where(eq(messagesTable.chatId, chatRow.id))
        .orderBy(desc(messagesTable.timestamp))
        .limit(limit)) as StoredMessage[];

      return rows.reverse().map((row) => {
        const raw = row.raw as { fileName?: unknown } | null | undefined;
        const fileName = typeof raw?.fileName === "string" ? raw.fileName : null;
        return {
          id: row.waMessageId,
          chatId: waChatId,
          from: row.fromMe ? "me" : waChatId,
          to: row.fromMe ? waChatId : "me",
          body: row.body,
          fromMe: row.fromMe,
          timestamp: row.timestamp,
          hasMedia: row.hasMedia,
          type: row.type,
          author: row.author,
          ack: null,
          isForwarded: false,
          isStarred: false,
          hasReaction: false,
          mediaUrl: row.mediaPath ? publicUrlFor(row.mediaPath) : null,
          mediaMimeType: row.mediaType,
          mediaFileName: fileName,
          quotedMessageId: null,
          quotedBody: null,
          quotedParticipant: null,
          quotedFromMe: null,
        };
      });
    } catch (err) {
      logger.warn({ err, waChatId }, "stored message fallback failed");
      return [];
    }
  }

  async stop(sessionId: string, removeData = false): Promise<void> {
    const s = this.devices.get(sessionId);
    if (s) {
      this.clearStartupWatchdog(s);
      this.clearAuthenticatedWatchdog(s);
      try {
        if (removeData) await s.client.logout();
      } catch (err) { logger.warn({ err }, "logout failed"); }
      try { await s.client.destroy(); } catch { /* noop */ }
      this.devices.delete(sessionId);
    }
    if (removeData) {
      const dir = path.join(SESSIONS_DIR, `session-${sessionId}`);
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
    }
  }

  private async persistChatSummaries(
    sessionId: string,
    state: DeviceState,
    chats: Array<{
      id: string;
      name: string;
      isGroup: boolean;
      phoneNumber: string | null;
      phoneCodeVerified: boolean;
      phoneCodeSource: PhoneResolution["source"] | null;
    }>,
  ) {
    if (!state.deviceRowId || chats.length === 0) return;
    let verifiedCodesUpdated = 0;
    for (const chat of chats) {
      const phoneNumber = phoneNumberFromResolvedValue(chat.phoneNumber);
      const hasVerifiedPhone = !chat.isGroup && chat.phoneCodeVerified && !!phoneNumber;
      await ensureChat({
        deviceId: state.deviceRowId,
        waChatId: chat.id,
        name: chat.name,
        isGroup: chat.isGroup,
        phoneNumber: hasVerifiedPhone ? phoneNumber : null,
        phoneCodeVerified: hasVerifiedPhone,
        phoneCodeSource: hasVerifiedPhone ? chat.phoneCodeSource ?? "contact" : null,
      });
      if (hasVerifiedPhone) verifiedCodesUpdated += 1;
    }
    this.emit(sessionId, "chats-updated", {
      reason: "whatsapp-sync",
      chatCount: chats.length,
      verifiedCodesUpdated,
    });
  }

  private async resolveLidPhoneNumbers(
    client: WAClient,
    ids: string[],
  ): Promise<Map<string, PhoneResolution>> {
    const uniqueIds = Array.from(new Set(ids.filter((id) => id.endsWith("@lid"))));
    const requested = new Set(uniqueIds);
    const resolvedPhones = new Map<string, PhoneResolution>();
    if (uniqueIds.length === 0 || typeof client.getContactLidAndPhone !== "function") {
      return resolvedPhones;
    }

    try {
      const rows = await client.getContactLidAndPhone(uniqueIds);
      rows.forEach((row) => {
        const lid = normalizedLid(row.lid);
        const phoneNumber = phoneNumberFromResolvedValue(row.pn);
        // Never map by array position. If WhatsApp does not echo the LID, the
        // association is ambiguous and must be treated as unverified.
        if (lid && requested.has(lid) && phoneNumber) {
          resolvedPhones.set(lid, { phoneNumber, source: "lid-resolution" });
        }
      });
    } catch (err) {
      logger.warn({ err }, "failed to resolve WhatsApp LID phone numbers");
    }

    return resolvedPhones;
  }

  async getChats(sessionId: string) {
    const s = this.devices.get(sessionId);
    if (!s || s.status !== "ready") throw new Error("Device not ready");
    const chats = (await s.client.getChats()) as any[];
    if (!s.firstChatsLoadedAt) {
      s.firstChatsLoadedAt = Date.now();
      this.logConnectionMetric(sessionId, s, "first_chats_loaded", { chatCount: chats.length });
    }
    const lidIds: string[] = [];
    for (const c of chats) {
      const chatId = serializedWid(c.id) ?? String(c.id ?? "");
      if (chatId.endsWith("@lid")) lidIds.push(chatId);
      if (Array.isArray(c.participants)) {
        for (const participant of c.participants) {
          const participantId = serializedWid(participant.id) ?? String(participant.id ?? "");
          if (participantId.endsWith("@lid")) lidIds.push(participantId);
        }
      }
    }
    const lidPhones = await this.resolveLidPhoneNumbers(s.client, lidIds);

    const mapped = await Promise.all(chats.map(async (c) => {
      const id = c.id?._serialized ?? c.id;
      const serializedId = String(id);
      const directPhoneFromId = phoneNumberFromSerializedWid(serializedId);
      const lidPhone = lidPhones.get(serializedId) ?? null;
      let phoneNumber = directPhoneFromId ?? lidPhone?.phoneNumber ?? null;
      let phoneCodeSource: PhoneResolution["source"] | null = directPhoneFromId
        ? "whatsapp-id"
        : lidPhone?.source ?? null;
      if (!c.isGroup && !phoneNumber && typeof c.getContact === "function") {
        try {
          const contact = await c.getContact();
          phoneNumber =
            phoneNumberFromSerializedWid(serializedWid(contact.id)) ??
            phoneNumberFromResolvedValue(contact.number);
          phoneCodeSource = phoneNumber ? "contact" : null;
        } catch {
          phoneNumber = null;
          phoneCodeSource = null;
        }
      }
      const phoneCode = phoneCodeFromNumber(phoneNumber);
      const participants = Array.isArray(c.participants)
        ? c.participants.map((participant: any) => {
            const participantId = serializedWid(participant.id) ?? String(participant.id ?? "");
            const participantUser = participant.id?.user ?? participantId.split("@")[0] ?? "";
            const participantLidPhone = lidPhones.get(participantId) ?? null;
            const participantDirectPhoneNumber = phoneNumberFromSerializedWid(participantId);
            const participantPhoneNumber =
              participantDirectPhoneNumber ??
              participantLidPhone?.phoneNumber ??
              null;
            const participantPhoneCodeSource: PhoneResolution["source"] | null =
              participantDirectPhoneNumber ? "whatsapp-id" : participantLidPhone?.source ?? null;
            return {
              id: participantId,
              name: participant.name || participant.pushname || participant.shortName || participantUser,
              phoneNumber: participantPhoneNumber,
              phoneCode: phoneCodeFromNumber(participantPhoneNumber),
              phoneCodeVerified: !!participantPhoneNumber,
              phoneCodeSource: participantPhoneCodeSource,
              isAdmin: !!participant.isAdmin || !!participant.isSuperAdmin,
            };
          })
        : [];
      return {
        id: serializedId,
        name: c.name || c.formattedTitle || c.id?.user || "",
        isGroup: c.isGroup,
        phoneNumber,
        phoneCode,
        phoneCodeVerified: !!phoneNumber,
        phoneCodeSource,
        participants,
        unreadCount: c.unreadCount ?? 0,
        timestamp: c.timestamp ?? null,
        lastMessage: c.lastMessage ? serializeMessage(c.lastMessage) : null,
        profilePicUrl: null as string | null,
      };
    }));

    void this.persistChatSummaries(sessionId, s, mapped).catch((err) => {
      logger.warn({ err, sessionId }, "failed to persist WhatsApp chat phone codes");
    });

    return mapped;
  }

  async getGroupParticipants(sessionId: string, chatId: string) {
    const s = this.devices.get(sessionId);
    if (!s || s.status !== "ready") throw new Error("Device not ready");
    const chat = (await s.client.getChatById(chatId)) as WAChatLike;
    if (!chat?.isGroup || !Array.isArray(chat.participants)) return [];

    const participantIds = Array.from(
      new Set(
        chat.participants
          .map((participant) => serializedWid(participant.id) ?? String(participant.id ?? ""))
          .filter((participantId) => participantId.trim().length > 0),
      ),
    );
    const lidPhones = await this.resolveLidPhoneNumbers(
      s.client,
      participantIds.filter((participantId) => participantId.endsWith("@lid")),
    );
    const participantById = new Map(
      chat.participants.map((participant) => [
        serializedWid(participant.id) ?? String(participant.id ?? ""),
        participant,
      ]),
    );

    return participantIds.map((participantId) => {
      const participant = participantById.get(participantId);
      const directPhoneNumber = phoneNumberFromSerializedWid(participantId);
      const lidPhone = lidPhones.get(participantId) ?? null;
      const phoneNumber = directPhoneNumber ?? lidPhone?.phoneNumber ?? null;
      const phoneCodeSource: PhoneResolution["source"] | null =
        directPhoneNumber ? "whatsapp-id" : lidPhone?.source ?? null;
      const participantUser = participantId.split("@")[0] ?? "";
      return {
        id: participantId,
        name: participant?.name || participant?.pushname || participant?.shortName || participantUser,
        phoneNumber,
        phoneCode: phoneCodeFromNumber(phoneNumber),
        phoneCodeVerified: !!phoneNumber,
        phoneCodeSource,
        isAdmin: !!participant?.isAdmin || !!participant?.isSuperAdmin,
      };
    });
  }

  async getMessages(sessionId: string, chatId: string, limit = 50, options: GetMessagesOptions = {}) {
    const s = this.devices.get(sessionId);
    if (!s || s.status !== "ready") throw new Error("Device not ready");
    try {
      const chat = (await s.client.getChatById(chatId)) as any;
      const msgs = (await chat.fetchMessages({ limit })) as any[];
      const serialized = msgs.map(serializeMessage);
      const ordered = msgs
        .map((rawMsg, index) => ({ rawMsg, payload: serialized[index] }))
        .filter((item): item is { rawMsg: any; payload: ReturnType<typeof serializeMessage> } => !!item.payload)
        .sort((a, b) => (a.payload.timestamp ?? 0) - (b.payload.timestamp ?? 0));

      for (const item of ordered) {
        await this.persistMessage(sessionId, s, item.rawMsg, item.payload, null, {
          countUnread: false,
          downloadMedia: options.downloadMedia === true,
        });
      }

      const enriched = (await this.enrichMessagesFromDb(s, chatId, serialized))
        .slice()
        .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
      this.emit(sessionId, "messages-hydrated", { chatId, messages: enriched });
      return enriched;
    } catch (err) {
      logger.warn({ err, sessionId, chatId }, "live fetchMessages failed; using stored messages");
      const stored = await this.getStoredMessages(s, chatId, limit);
      if (stored.length) this.emit(sessionId, "messages-hydrated", { chatId, messages: stored });
      return stored;
    }
  }

  async markChatSeen(sessionId: string, chatId: string) {
    const s = this.devices.get(sessionId);
    if (!s || s.status !== "ready") return false;
    if (typeof s.client.sendSeen === "function") {
      return s.client.sendSeen(chatId);
    }
    const chat = (await s.client.getChatById(chatId)) as { sendSeen?: () => Promise<boolean> };
    return chat.sendSeen?.() ?? false;
  }

  async sendMessage(sessionId: string, chatId: string, body: string, quotedMessageId?: string) {
    const s = this.devices.get(sessionId);
    if (!s || s.status !== "ready") throw new Error("Device not ready");
    const sent = await s.client.sendMessage(
      chatId,
      body,
      quotedMessageId ? { quotedMessageId, ignoreQuoteErrors: false } : undefined,
    );
    const payload = serializeMessage(sent);
    if (this.rememberMessage(sessionId, payload.id)) {
      this.emit(sessionId, "message", payload);
      void this.persistMessage(sessionId, s, sent, payload);
    }
    return payload;
  }

  async sendMedia(
    sessionId: string,
    chatId: string,
    filePath: string,
    mimeType: string,
    fileName: string,
    caption?: string,
    sendAudioAsVoice = false,
  ) {
    const s = this.devices.get(sessionId);
    if (!s || s.status !== "ready") throw new Error("Device not ready");
    const { MessageMedia } = require("whatsapp-web.js") as {
      MessageMedia: {
        fromFilePath: (path: string) => { mimetype: string; filename: string; data: string };
      };
    };
    const media = MessageMedia.fromFilePath(filePath);
    media.filename = fileName;
    media.mimetype = mimeType;
    const options = {
      ...(caption ? { caption } : {}),
      ...(sendAudioAsVoice && mimeType.startsWith("audio/") ? { sendAudioAsVoice: true } : {}),
    };
    const sent = await s.client.sendMessage(chatId, media, Object.keys(options).length ? options : undefined);
    const fileBytes = await fs.promises.readFile(filePath);
    const serializedSent = serializeMessage(sent);
    const payload = {
      ...serializedSent,
      hasMedia: true,
      type: messageTypeForMime(mimeType, serializedSent.type),
      mediaMimeType: mimeType,
      mediaFileName: fileName,
    };
    const stored = await this.persistMessage(sessionId, s, sent, payload, {
      data: fileBytes.toString("base64"),
      mimetype: mimeType,
      filename: fileName,
      filesize: fileBytes.byteLength,
    });
    const message = stored ?? payload;
    this.emitMessageIfNew(sessionId, message);
    return message;
  }

  private async getLiveMessage(sessionId: string, messageId: string) {
    const s = this.devices.get(sessionId);
    if (!s || s.status !== "ready") throw new Error("Device not ready");
    if (typeof s.client.getMessageById !== "function") {
      throw new Error("WhatsApp no permite recuperar este mensaje en esta sesión");
    }
    const msg = (await s.client.getMessageById(messageId)) as any;
    if (!msg) throw new Error("Mensaje no disponible en WhatsApp Web");
    return msg;
  }

  async getMessageInfo(sessionId: string, messageId: string) {
    const msg = await this.getLiveMessage(sessionId, messageId);
    const info = typeof msg.getInfo === "function" ? await msg.getInfo() : null;
    return {
      ...serializeMessage(msg),
      info: info
        ? {
            delivery: Array.isArray(info.delivery) ? info.delivery : [],
            deliveryRemaining: Number(info.deliveryRemaining ?? 0),
            read: Array.isArray(info.read) ? info.read : [],
            readRemaining: Number(info.readRemaining ?? 0),
            played: Array.isArray(info.played) ? info.played : [],
            playedRemaining: Number(info.playedRemaining ?? 0),
          }
        : null,
    };
  }

  async reactToMessage(sessionId: string, messageId: string, reaction: string) {
    const msg = await this.getLiveMessage(sessionId, messageId);
    if (typeof msg.react !== "function") throw new Error("Este mensaje no admite reacciones");
    await msg.react(reaction);
    return { ok: true, reaction };
  }

  private async recentFromMeMessages(chat: any, limit = 30): Promise<any[]> {
    if (typeof chat?.fetchMessages !== "function") return [];
    try {
      const messages = await chat.fetchMessages({ limit, fromMe: true });
      return Array.isArray(messages) ? messages : [];
    } catch {
      return [];
    }
  }

  private async waitForForwardedMessage(
    targetChat: any,
    targetChatId: string,
    knownIds: Set<string>,
    source: ReturnType<typeof serializeMessage>,
    startedAt: number,
  ): Promise<any | null> {
    const waits = [250, 500, 800, 1200, 1800, 2500];
    for (const waitMs of waits) {
      await delay(waitMs);
      const recent = await this.recentFromMeMessages(targetChat, 40);
      const candidates = recent
        .map((raw) => ({ raw, payload: serializeMessage(raw) }))
        .filter(({ payload }) => {
          if (!payload.id || knownIds.has(payload.id)) return false;
          if (!payload.fromMe) return false;
          if (payload.chatId !== targetChatId) return false;
          return payload.timestamp >= startedAt - 5;
        })
        .map((candidate) => {
          const bodyMatches = source.body && candidate.payload.body === source.body ? 20 : 0;
          const mediaMatches = candidate.payload.hasMedia === source.hasMedia ? 10 : 0;
          const typeMatches = candidate.payload.type === source.type ? 5 : 0;
          const forwardedBonus = candidate.payload.isForwarded ? 2 : 0;
          return {
            ...candidate,
            score: bodyMatches + mediaMatches + typeMatches + forwardedBonus + candidate.payload.timestamp,
          };
        })
        .sort((a, b) => b.score - a.score);

      if (candidates[0]?.raw) return candidates[0].raw;
    }
    return null;
  }

  private async downloadMessageMediaBestEffort(...messages: any[]): Promise<DownloadedWAMedia | null> {
    for (const message of messages) {
      if (!message || typeof message.downloadMedia !== "function") continue;
      try {
        const media = (await message.downloadMedia()) as DownloadedWAMedia | undefined;
        if (media?.data) return media;
      } catch (err) {
        logger.warn({ err }, "forwarded media download attempt failed");
      }
    }
    return null;
  }

  private async resendMessageContent(
    sessionId: string,
    state: DeviceState,
    sourceMsg: any,
    sourcePayload: ReturnType<typeof serializeMessage>,
    targetChatId: string,
  ) {
    if (sourcePayload.hasMedia && typeof sourceMsg.downloadMedia === "function") {
      const media = (await sourceMsg.downloadMedia()) as DownloadedWAMedia | undefined;
      if (!media?.data) throw new Error("WhatsApp no devolvió el archivo para reenviar");
      const mediaType = media.mimetype || sourcePayload.mediaMimeType || "application/octet-stream";
      const fileName = resolvedMediaFileName(media, sourcePayload, mediaType);
      const { MessageMedia } = require("whatsapp-web.js") as {
        MessageMedia: new (
          mimetype: string,
          data: string,
          filename?: string | null,
          filesize?: number | null,
        ) => { mimetype: string; data: string; filename?: string | null; filesize?: number | null };
      };
      const mediaMessage = new MessageMedia(mediaType, media.data, fileName, media.filesize ?? null);
      const sent = await state.client.sendMessage(
        targetChatId,
        mediaMessage,
        sourcePayload.body ? { caption: sourcePayload.body } : undefined,
      );
      if (!sent) throw new Error("WhatsApp no confirmó el reenvío del archivo");
      const serializedSent = serializeMessage(sent);
      const payload = {
        ...serializedSent,
        hasMedia: true,
        type: serializedSent.type === "chat" ? sourcePayload.type : serializedSent.type,
        mediaMimeType: mediaType,
        mediaFileName: fileName,
      };
      const stored = await this.persistMessage(sessionId, state, sent, payload, media);
      const message = stored ?? payload;
      this.emitMessageIfNew(sessionId, message);
      return { ok: true, message, fallback: true };
    }

    const body = sourcePayload.body.trim();
    if (!body) throw new Error("Este mensaje no se puede reenviar desde esta sesión");
    const sent = await state.client.sendMessage(targetChatId, body);
    if (!sent) throw new Error("WhatsApp no confirmó el reenvío del mensaje");
    const payload = serializeMessage(sent);
    const stored = await this.persistMessage(sessionId, state, sent, payload);
    const message = stored ?? payload;
    this.emitMessageIfNew(sessionId, message);
    return { ok: true, message, fallback: true };
  }

  async forwardMessage(sessionId: string, messageId: string, targetChatId: string) {
    const s = this.devices.get(sessionId);
    if (!s || s.status !== "ready") throw new Error("Device not ready");
    const msg = await this.getLiveMessage(sessionId, messageId);
    const sourcePayload = serializeMessage(msg);
    const targetChat = await s.client.getChatById(targetChatId);
    const knownIds = new Set((await this.recentFromMeMessages(targetChat, 40)).map((item) => serializeMessage(item).id));
    const startedAt = Math.floor(Date.now() / 1000);

    if (typeof msg.forward !== "function") {
      return this.resendMessageContent(sessionId, s, msg, sourcePayload, targetChatId);
    }

    try {
      await msg.forward(targetChatId);
    } catch (err) {
      logger.warn({ err, sessionId, messageId, targetChatId }, "native forward failed; resending message content");
      return this.resendMessageContent(sessionId, s, msg, sourcePayload, targetChatId);
    }

    const forwardedMsg = await this.waitForForwardedMessage(targetChat, targetChatId, knownIds, sourcePayload, startedAt);
    if (!forwardedMsg) {
      logger.warn({ sessionId, messageId, targetChatId }, "native forward did not expose forwarded message; resending content for CRM visibility");
      return this.resendMessageContent(sessionId, s, msg, sourcePayload, targetChatId);
    }

    const forwardedPayload = serializeMessage(forwardedMsg);
    const downloadedMedia = sourcePayload.hasMedia
      ? await this.downloadMessageMediaBestEffort(forwardedMsg, msg)
      : null;
    const mediaType = downloadedMedia?.mimetype || forwardedPayload.mediaMimeType || sourcePayload.mediaMimeType;
    const fileName = mediaType
      ? resolvedMediaFileName(downloadedMedia, sourcePayload.mediaFileName ? sourcePayload : forwardedPayload, mediaType)
      : forwardedPayload.mediaFileName || sourcePayload.mediaFileName;
    const payload = sourcePayload.hasMedia
      ? {
          ...forwardedPayload,
          hasMedia: true,
          type: forwardedPayload.type === "chat" ? sourcePayload.type : forwardedPayload.type,
          mediaMimeType: mediaType ?? forwardedPayload.mediaMimeType,
          mediaFileName: fileName ?? forwardedPayload.mediaFileName,
        }
      : forwardedPayload;
    const stored = await this.persistMessage(sessionId, s, forwardedMsg, payload, downloadedMedia);
    const message = stored ?? payload;
    this.emitMessageIfNew(sessionId, message);
    return { ok: true, message };
  }

  async downloadMessageMedia(sessionId: string, messageId: string) {
    const msg = await this.getLiveMessage(sessionId, messageId);
    if (!msg.hasMedia || typeof msg.downloadMedia !== "function") {
      throw new Error("Este mensaje no tiene archivo descargable");
    }
    const media = await msg.downloadMedia();
    if (!media?.data) throw new Error("WhatsApp no devolvió el archivo");
    return {
      data: media.data as string,
      mimetype: (media.mimetype || "application/octet-stream") as string,
      filename: (media.filename || msg.filename || msg._data?.filename || null) as string | null,
      filesize: typeof media.filesize === "number" ? media.filesize : null,
    };
  }

  async starMessage(sessionId: string, messageId: string, starred: boolean) {
    const msg = await this.getLiveMessage(sessionId, messageId);
    const method = starred ? msg.star : msg.unstar;
    if (typeof method !== "function") throw new Error("Este mensaje no admite destacado");
    await method.call(msg);
    return { ok: true, starred };
  }

  async pinMessage(sessionId: string, messageId: string, pinned: boolean, duration = 604800) {
    const msg = await this.getLiveMessage(sessionId, messageId);
    const method = pinned ? msg.pin : msg.unpin;
    if (typeof method !== "function") throw new Error("Este mensaje no admite fijado");
    const result = pinned ? await method.call(msg, duration) : await method.call(msg);
    if (result === false) throw new Error("WhatsApp no permitió fijar este mensaje");
    return { ok: true, pinned };
  }

  async deleteMessage(sessionId: string, messageId: string, everyone = false) {
    const msg = await this.getLiveMessage(sessionId, messageId);
    if (typeof msg.delete !== "function") throw new Error("Este mensaje no se puede eliminar");
    await msg.delete(everyone, true);
    return { ok: true };
  }
}

function serializeMessage(m: any) {
  const chatId = m.from === m.to ? m.from : (m.fromMe ? m.to : m.from);
  const mediaMimeType = (m._data?.mimetype ?? m.mimetype ?? null) as string | null;
  const mediaFileName = (m._data?.filename ?? m.filename ?? null) as string | null;
  const quoted = m._data?.quotedMsg ?? null;
  const quotedId =
    m._data?.quotedStanzaID ??
    quoted?.id?._serialized ??
    quoted?.id?.id ??
    null;
  const quotedParticipantRaw =
    m._data?.quotedParticipant ??
    quoted?.author ??
    quoted?.from ??
    quoted?.id?.remote ??
    null;
  const quotedParticipant =
    typeof quotedParticipantRaw === "string"
      ? quotedParticipantRaw
      : (quotedParticipantRaw?._serialized ?? null);
  const quotedBody =
    quoted?.body ??
    quoted?.caption ??
    quoted?.pollName ??
    (quoted?.type ? `[${quoted.type}]` : null);
  const quotedFromMe =
    typeof quoted?.id?.fromMe === "boolean"
      ? quoted.id.fromMe
      : typeof quoted?.fromMe === "boolean"
        ? quoted.fromMe
        : null;
  return {
    id: (m.id?._serialized ?? m.id) as string,
    chatId: chatId as string,
    from: m.from as string,
    to: m.to as string,
    body: (m.body ?? "") as string,
    fromMe: !!m.fromMe,
    timestamp: (m.timestamp ?? Math.floor(Date.now() / 1000)) as number,
    hasMedia: !!m.hasMedia,
    type: (m.type ?? "chat") as string,
    author: (m.author ?? null) as string | null,
    ack: typeof m.ack === "number" ? m.ack : null,
    isForwarded: !!m.isForwarded,
    isStarred: !!m.isStarred,
    hasReaction: !!m.hasReaction,
    mediaUrl: null as string | null,
    mediaMimeType,
    mediaFileName,
    quotedMessageId: quotedId as string | null,
    quotedBody: (quotedBody ?? null) as string | null,
    quotedParticipant: quotedParticipant as string | null,
    quotedFromMe,
  };
}

function messageTypeForMime(mimeType: string, fallback: string) {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return fallback && fallback !== "chat" ? fallback : "audio";
  return fallback && fallback !== "chat" ? fallback : "document";
}

export const waManager = new WAManager();
