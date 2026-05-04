const DB_NAME = "crmt2-chat-cache";
const STORE_NAME = "snapshots";
const DB_VERSION = 1;
const MAX_MESSAGES_PER_CHAT = 100;
const MAX_TEAM_MESSAGES_PER_PEER = 50;

type CacheEnvelope<T> = {
  key: string;
  value: T;
  updatedAt: number;
  version: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function canUseIndexedDb() {
  return typeof window !== "undefined" && !!window.indexedDB;
}

function openCacheDb() {
  if (!canUseIndexedDb()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir IndexedDB"));
  }).catch((error) => {
    dbPromise = null;
    throw error;
  });

  return dbPromise;
}

async function readCache<T>(key: string): Promise<CacheEnvelope<T> | null> {
  const db = await openCacheDb().catch(() => null);
  if (!db) return null;

  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => resolve((request.result as CacheEnvelope<T> | undefined) ?? null);
    request.onerror = () => resolve(null);
  });
}

async function writeCache<T>(key: string, value: T) {
  const db = await openCacheDb().catch(() => null);
  if (!db) return;

  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({
      key,
      value,
      updatedAt: Date.now(),
      version: DB_VERSION,
    } satisfies CacheEnvelope<T>);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

function chatsKey(sessionId: string) {
  return `chats:${sessionId}`;
}

function messagesKey(sessionId: string, chatId: string) {
  return `messages:${sessionId}:${chatId}`;
}

function teamCollaboratorsKey() {
  return "team:collaborators";
}

function teamMessagesKey(peerUserId: number) {
  return `team:messages:${peerUserId}`;
}

export async function readCachedChats<T>(sessionId: string) {
  return readCache<T[]>(chatsKey(sessionId));
}

export async function writeCachedChats<T>(sessionId: string, chats: T[]) {
  await writeCache(chatsKey(sessionId), chats);
}

export async function readCachedMessages<T>(sessionId: string, chatId: string) {
  return readCache<T[]>(messagesKey(sessionId, chatId));
}

export async function writeCachedMessages<T extends { timestamp?: number }>(
  sessionId: string,
  chatId: string,
  messages: T[],
) {
  const compact = messages
    .slice()
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
    .slice(-MAX_MESSAGES_PER_CHAT);
  await writeCache(messagesKey(sessionId, chatId), compact);
}

export async function readCachedTeamCollaborators<T>() {
  return readCache<T[]>(teamCollaboratorsKey());
}

export async function writeCachedTeamCollaborators<T>(collaborators: T[]) {
  await writeCache(teamCollaboratorsKey(), collaborators);
}

export async function readCachedTeamMessages<T>(peerUserId: number) {
  return readCache<T[]>(teamMessagesKey(peerUserId));
}

export async function writeCachedTeamMessages<T extends { createdAt?: string; id?: number }>(
  peerUserId: number,
  messages: T[],
) {
  const compact = messages
    .slice()
    .sort((a, b) => {
      const left = a.createdAt ? Date.parse(a.createdAt) : 0;
      const right = b.createdAt ? Date.parse(b.createdAt) : 0;
      if (left !== right) return left - right;
      return (a.id ?? 0) - (b.id ?? 0);
    })
    .slice(-MAX_TEAM_MESSAGES_PER_PEER);
  await writeCache(teamMessagesKey(peerUserId), compact);
}
