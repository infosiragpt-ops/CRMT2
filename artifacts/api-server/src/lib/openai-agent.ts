import {
  agentSettingsTable,
  chatLabelsTable,
  chatsTable,
  db,
  devicesTable,
  messagesTable,
  type AgentTrainingConfig,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import fs from "node:fs/promises";
import { lookup as lookupMimeType } from "mime-types";
import { decryptSecret } from "./secret";
import { blockedPhoneNumberMessage, containsBlockedPhoneNumber } from "./message-security";
import { logger } from "./logger";

type AgentMessage = {
  id: string;
  chatId: string;
  body: string;
  fromMe: boolean;
  type: string;
  hasMedia: boolean;
  timestamp: number;
};

type SendMessage = (chatId: string, body: string, quotedMessageId?: string) => Promise<unknown>;
type InputPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "auto" }
  | { type: "input_file"; filename: string; file_data: string };
type ResponseInput = string | Array<{ role: "user"; content: InputPart[] }>;

const processing = new Map<string, number>();
const CONVERSATION_CONTEXT_CHAR_LIMIT = 1_000_000;
const MAX_INLINE_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TRAINING_ATTACHMENTS = 10;
export const DEFAULT_OPENAI_MODELS = [
  "gpt-4.1-mini",
  "gpt-4.1",
  "gpt-4o-mini",
  "gpt-4o",
  "o4-mini",
  "o3-mini",
  "o3",
];

function cleanText(value: unknown, max = 4000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function extractOutputText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text.trim();
  const parts: string[] = [];
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (typeof content?.text === "string") parts.push(content.text);
      if (typeof content?.output_text === "string") parts.push(content.output_text);
    }
  }
  return parts.join("\n").trim();
}

function rulesText(config: AgentTrainingConfig) {
  const enabled = config.trainingEnabled ?? {};
  const textEnabled = enabled.text !== false;
  const rules = textEnabled
    ? (config.textRules ?? [])
    .map((rule, index) => ({
      n: index + 1,
      trigger: cleanText(rule.trigger, 300),
      response: cleanText(rule.response, 1200),
    }))
        .filter((rule) => rule.trigger || rule.response)
    : [];

  const media = config.assets ?? {};
  const assets = [
    ...(enabled.images === true ? (media.images ?? []).map((asset) => ({ type: "imagen", ...asset })) : []),
    ...(enabled.video === true ? (media.video ?? []).map((asset) => ({ type: "video", ...asset })) : []),
    ...(enabled.pdf === true ? (media.pdf ?? []).map((asset) => ({ type: "pdf", ...asset })) : []),
  ]
    .map((asset, index) => ({
      n: index + 1,
      type: asset.type,
      fileName: cleanText(asset.fileName, 180),
      trigger: cleanText(asset.trigger, 300),
      availableForModel: !!asset.storedPath && asset.type !== "video",
    }))
    .filter((asset) => asset.fileName || asset.trigger);

  return [
    rules.length > 0 ? `Reglas y respuestas configuradas:\n${JSON.stringify(rules, null, 2)}` : "",
    assets.length > 0
      ? `Archivos entrenados disponibles para referencia interna:\n${JSON.stringify(assets, null, 2)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function shouldAgentRespond(config: AgentTrainingConfig, chatLabelIds: number[]) {
  const scope = config.responseScope ?? "tagged";
  const selectedLabelIds = (config.selectedLabelIds ?? []).filter(Number.isFinite);
  const hasAnyLabel = chatLabelIds.length > 0;
  const hasSelectedLabel =
    selectedLabelIds.length > 0 && chatLabelIds.some((labelId) => selectedLabelIds.includes(labelId));

  if (scope === "all") return true;
  if (scope === "notTagged") return !hasAnyLabel;
  if (scope === "exceptTagged") return selectedLabelIds.length > 0 ? !hasSelectedLabel : true;
  if (scope === "tagged") return selectedLabelIds.length > 0 ? hasSelectedLabel : hasAnyLabel;
  return false;
}

async function recentChatContext(chatId: number) {
  const rows = await db
    .select({
      fromMe: messagesTable.fromMe,
      body: messagesTable.body,
      type: messagesTable.type,
      hasMedia: messagesTable.hasMedia,
      mediaType: messagesTable.mediaType,
      timestamp: messagesTable.timestamp,
    })
    .from(messagesTable)
    .where(eq(messagesTable.chatId, chatId))
    .orderBy(desc(messagesTable.timestamp))
    .limit(1000);

  const lines = rows
    .reverse()
    .map((msg) => {
      const media = msg.hasMedia ? `[archivo ${msg.mediaType || msg.type}]` : "";
      const body = cleanText(msg.body, 2000);
      return `${msg.fromMe ? "CRM" : "Cliente"}: ${body || media}`;
    })
    .filter((line) => !line.endsWith(": "));

  let total = 0;
  const kept: string[] = [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    total += line.length + 1;
    if (total > CONVERSATION_CONTEXT_CHAR_LIMIT) break;
    kept.unshift(line);
  }
  return kept.join("\n");
}

function isImageMime(mimeType: string) {
  return mimeType.startsWith("image/");
}

function fileNameFromPath(filePath: string) {
  return filePath.split(/[\\/]/).pop() || "archivo";
}

async function inputPartFromFile(
  filePath: string | null | undefined,
  mimeType: string | null | undefined,
  fileName?: string | null,
): Promise<InputPart | null> {
  if (!filePath) return null;
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_INLINE_FILE_BYTES) return null;
    const resolvedMime = cleanText(mimeType, 120) || lookupMimeType(filePath) || "application/octet-stream";
    const data = await fs.readFile(filePath, "base64");
    const dataUrl = `data:${resolvedMime};base64,${data}`;
    if (isImageMime(resolvedMime)) {
      return { type: "input_image", image_url: dataUrl, detail: "auto" };
    }
    if (
      resolvedMime === "application/pdf" ||
      resolvedMime.startsWith("text/") ||
      resolvedMime.includes("wordprocessingml") ||
      resolvedMime.includes("msword")
    ) {
      return {
        type: "input_file",
        filename: cleanText(fileName, 180) || fileNameFromPath(filePath),
        file_data: dataUrl,
      };
    }
    return null;
  } catch (err) {
    logger.warn({ err, filePath }, "agent file input failed");
    return null;
  }
}

async function currentMessageMediaPart(chatDbId: number, waMessageId: string): Promise<InputPart | null> {
  const [row] = await db
    .select({
      mediaType: messagesTable.mediaType,
      mediaPath: messagesTable.mediaPath,
      raw: messagesTable.raw,
    })
    .from(messagesTable)
    .where(and(eq(messagesTable.chatId, chatDbId), eq(messagesTable.waMessageId, waMessageId)));
  const raw = row?.raw as { fileName?: unknown } | null | undefined;
  const fileName = typeof raw?.fileName === "string" ? raw.fileName : null;
  return inputPartFromFile(row?.mediaPath, row?.mediaType, fileName);
}

async function trainingInputParts(config: AgentTrainingConfig): Promise<InputPart[]> {
  const enabled = config.trainingEnabled ?? {};
  const media = config.assets ?? {};
  const candidates = [
    ...(enabled.images === true ? (media.images ?? []) : []),
    ...(enabled.pdf === true ? (media.pdf ?? []) : []),
  ].slice(0, MAX_TRAINING_ATTACHMENTS);
  const parts: InputPart[] = [];
  for (const asset of candidates) {
    const part = await inputPartFromFile(asset.storedPath, asset.mimeType, asset.fileName);
    if (part) parts.push(part);
  }
  return parts;
}

async function createOpenAiResponse(apiKey: string, model: string, input: ResponseInput, instructions: string, maxOutputTokens = 520) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      instructions,
      input,
      max_output_tokens: maxOutputTokens,
      store: false,
    }),
  });

  const payload = (await res.json().catch(() => null)) as any;
  if (!res.ok) {
    const message =
      typeof payload?.error?.message === "string"
        ? payload.error.message
        : `OpenAI respondió ${res.status}`;
    throw new Error(message);
  }
  return extractOutputText(payload);
}

function isResponseModelId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const id = value.trim().toLowerCase();
  if (!/^(gpt-|o\d|chatgpt-)/.test(id)) return false;
  return ![
    "audio",
    "dall-e",
    "embedding",
    "image",
    "moderation",
    "realtime",
    "search",
    "transcribe",
    "tts",
    "whisper",
  ].some((marker) => id.includes(marker));
}

function sortModelIds(models: string[]) {
  const preferred = new Map(DEFAULT_OPENAI_MODELS.map((model, index) => [model, index]));
  return Array.from(new Set(models))
    .filter(Boolean)
    .sort((a, b) => {
      const rankA = preferred.get(a) ?? 999;
      const rankB = preferred.get(b) ?? 999;
      if (rankA !== rankB) return rankA - rankB;
      return a.localeCompare(b);
    });
}

export async function listOpenAiModels(apiKey: string) {
  const key = cleanText(apiKey, 300);
  if (!key.startsWith("sk-")) throw new Error("API key de OpenAI inválida");
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
  });
  const payload = (await res.json().catch(() => null)) as any;
  if (!res.ok) {
    const message =
      typeof payload?.error?.message === "string"
        ? payload.error.message
        : `OpenAI respondió ${res.status}`;
    throw new Error(message);
  }

  const modelIds = (Array.isArray(payload?.data) ? (payload.data as Array<{ id?: unknown }>) : [])
    .map((model) => model.id)
    .filter(isResponseModelId);
  const sorted = sortModelIds(modelIds);
  return sorted.length > 0 ? sorted : DEFAULT_OPENAI_MODELS;
}

export async function validateOpenAiKey(apiKey: string, model = "gpt-4.1-mini") {
  const key = cleanText(apiKey, 300);
  if (!key.startsWith("sk-")) throw new Error("API key de OpenAI inválida");
  const text = await createOpenAiResponse(
    key,
    model,
    "Responde solamente OK.",
    "Eres una prueba de conexión. Responde exactamente OK.",
  );
  if (!text) throw new Error("OpenAI no devolvió respuesta");
}

export async function maybeRespondWithAgent(args: {
  sessionId: string;
  message: AgentMessage;
  sendMessage: SendMessage;
}) {
  const { sessionId, message, sendMessage } = args;
  if (message.fromMe || !message.id || !message.chatId) return;
  if (message.chatId.endsWith("@g.us")) return;
  if (processing.has(message.id)) return;
  processing.set(message.id, Date.now());

  try {
    const [device] = await db
      .select({ id: devicesTable.id, userId: devicesTable.userId })
      .from(devicesTable)
      .where(eq(devicesTable.sessionId, sessionId));
    if (!device) return;

    const [settings] = await db
      .select()
      .from(agentSettingsTable)
      .where(eq(agentSettingsTable.userId, device.userId));
    if (!settings?.enabled) return;

    const apiKey = decryptSecret(settings.openAiApiKeyEncrypted);
    if (!apiKey) return;

    const [chat] = await db
      .select({ id: chatsTable.id, waChatId: chatsTable.waChatId, name: chatsTable.name })
      .from(chatsTable)
      .where(and(eq(chatsTable.deviceId, device.id), eq(chatsTable.waChatId, message.chatId)));
    if (!chat) return;

    const body = cleanText(message.body);
    const userMessage = body || (message.hasMedia ? `El cliente envió un archivo tipo ${message.type}.` : "");
    if (!userMessage) return;

    const config = (settings.trainingConfig ?? {}) as AgentTrainingConfig;
    const chatLabelRows = await db
      .select({ labelId: chatLabelsTable.labelId })
      .from(chatLabelsTable)
      .where(eq(chatLabelsTable.chatId, chat.id));
    if (!shouldAgentRespond(config, chatLabelRows.map((row) => row.labelId))) return;

    const context = await recentChatContext(chat.id);
    const training = rulesText(config);
    const instructions = [
      "Eres el agente interno de ventas y atención de un CRM de WhatsApp. Responde en español claro, breve y profesional.",
      "Tu objetivo es vender y orientar usando estrictamente el entrenamiento disponible: texto, imágenes, documentos y referencias cargadas.",
      "Mantén el hilo de la conversación por cliente usando todo el contexto reciente proporcionado. No repitas preguntas ya contestadas.",
      "Si el cliente envía una imagen, analiza visualmente el contenido y cualquier texto visible como OCR del modelo antes de responder.",
      "Si el cliente envía un PDF o documento compatible, analiza su contenido con el modelo antes de responder.",
      "Para videos u otros archivos no analizables directamente, usa el nombre, tipo y disparador configurado como referencia y pide precisión si hace falta.",
      "No inventes datos, precios, diagnósticos ni promesas. Si falta información, pide una aclaración corta.",
      "Cierra con una siguiente acción comercial natural cuando corresponda.",
      "Si el cliente describe una emergencia, salud, seguridad o riesgo para una persona, no diagnostiques ni des instrucciones clínicas; indica que un humano lo atenderá y recomienda contactar servicios de emergencia locales.",
      "No incluyas números telefónicos en la respuesta.",
      training,
    ]
      .filter(Boolean)
      .join("\n\n");

    const mediaPart = message.hasMedia ? await currentMessageMediaPart(chat.id, message.id) : null;
    const trainingParts = await trainingInputParts(config);
    const inputText = [
      `Chat: ${chat.name || chat.waChatId}`,
      context ? `Memoria de conversación de este cliente, preservada hasta 1,000,000 caracteres si el modelo lo permite:\n${context}` : "",
      `Último mensaje del cliente:\n${userMessage}`,
      mediaPart ? "Archivo del último mensaje adjunto para análisis del modelo." : "",
      trainingParts.length > 0 ? "Archivos de entrenamiento adjuntos para usar como contexto interno." : "",
      "Genera solo el texto exacto que se enviará por WhatsApp.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const inputParts: InputPart[] = [{ type: "input_text", text: inputText }];
    if (mediaPart) inputParts.push(mediaPart);
    inputParts.push(...trainingParts);

    let rawAnswer = "";
    try {
      rawAnswer = await createOpenAiResponse(
        apiKey,
        settings.model,
        [{ role: "user", content: inputParts }],
        instructions,
        700,
      );
    } catch (err) {
      if (inputParts.length <= 1) throw err;
      logger.warn({ err, sessionId, messageId: message.id }, "agent multimodal reply failed; retrying text only");
      rawAnswer = await createOpenAiResponse(
        apiKey,
        settings.model,
        [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `${inputText}\n\nNota interna: el modelo no pudo abrir uno o más archivos adjuntos. Responde sin inventar su contenido y pide una aclaración si el archivo es necesario.`,
              },
            ],
          },
        ],
        instructions,
        700,
      );
    }

    const answer = cleanText(rawAnswer, 1500);
    if (!answer) return;
    if (containsBlockedPhoneNumber(answer)) throw new Error(blockedPhoneNumberMessage);

    await sendMessage(message.chatId, answer, message.id);
    logger.info({ sessionId, chatId: message.chatId }, "agent sent reply");
  } catch (err) {
    logger.warn({ err, sessionId, messageId: message.id }, "agent reply failed");
  } finally {
    const cutoff = Date.now() - 20 * 60_000;
    for (const [id, createdAt] of processing) {
      if (createdAt < cutoff || processing.size > 1000) processing.delete(id);
    }
  }
}
