import { Router, type IRouter } from "express";
import { agentSettingsTable, db, type AgentTrainingConfig } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";
import { decryptSecret, encryptSecret } from "../lib/secret";
import { DEFAULT_OPENAI_MODELS, listOpenAiModels, validateOpenAiKey } from "../lib/openai-agent";
import { uploadAgentTrainingFiles } from "../lib/uploads";

const router: IRouter = Router();

router.use(requireAdmin);

const DEFAULT_MODEL = DEFAULT_OPENAI_MODELS[0] ?? "gpt-4.1-mini";
const RESPONSE_SCOPES = new Set(["tagged", "notTagged", "all", "exceptTagged"]);

function cleanString(value: unknown, max = 4000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function apiKeyPreview(encryptedKey?: string | null) {
  try {
    const key = decryptSecret(encryptedKey);
    if (!key) return null;
    const prefix = key.startsWith("sk-proj-") ? "sk-proj-" : key.startsWith("sk-") ? "sk-" : key.slice(0, 4);
    return `${prefix}...${key.slice(-4)}`;
  } catch {
    return null;
  }
}

function parseSettingsPayload(body: unknown) {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (typeof raw.settings !== "string") return raw;
  try {
    const parsed = JSON.parse(raw.settings);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function filesByField(reqFiles: unknown) {
  const files = Array.isArray(reqFiles) ? (reqFiles as Express.Multer.File[]) : [];
  return new Map(files.map((file) => [file.fieldname, file]));
}

function normalizeTrainingConfig(
  value: unknown,
  uploadedFiles = new Map<string, Express.Multer.File>(),
  existingConfig: AgentTrainingConfig = {},
): AgentTrainingConfig {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const responseScope = cleanString(raw.responseScope, 40);
  const rawTrainingEnabled =
    raw.trainingEnabled && typeof raw.trainingEnabled === "object"
      ? (raw.trainingEnabled as Record<string, unknown>)
      : {};
  const rawRules = Array.isArray(raw.textRules) ? raw.textRules : [];
  const textRules = rawRules
    .map((rule) => {
      const r = rule && typeof rule === "object" ? (rule as Record<string, unknown>) : {};
      return {
        trigger: cleanString(r.trigger, 300),
        response: cleanString(r.response, 1500),
      };
    })
    .filter((rule) => rule.trigger || rule.response)
    .slice(0, 40);

  const normalizeAssets = (kind: "images" | "video" | "pdf") => {
    const assetsRaw =
      raw.assets && typeof raw.assets === "object"
        ? (raw.assets as Record<string, unknown>)[kind]
        : [];
    const hasUploadForKind = Array.from(uploadedFiles.keys()).some((field) => field.startsWith(`${kind}:`));
    if ((!Array.isArray(assetsRaw) || assetsRaw.length === 0) && !hasUploadForKind) {
      return existingConfig.assets?.[kind] ?? [];
    }
    return (Array.isArray(assetsRaw) ? assetsRaw : [])
      .map((asset) => {
        const a = asset && typeof asset === "object" ? (asset as Record<string, unknown>) : {};
        const uploadField = cleanString(a.uploadField, 80);
        const uploaded = uploadField ? uploadedFiles.get(uploadField) : undefined;
        return {
          fileName: cleanString(uploaded?.originalname || a.fileName, 180),
          mimeType: cleanString(uploaded?.mimetype || a.mimeType, 120),
          sizeBytes: Number(uploaded?.size || a.sizeBytes) || 0,
          trigger: cleanString(a.trigger, 300),
          storedPath: cleanString(uploaded?.path || a.storedPath, 2000),
        };
      })
      .filter((asset) => asset.fileName || asset.trigger || asset.storedPath)
      .slice(0, 80);
  };

  return {
    voiceReplies: raw.voiceReplies === true,
    audioToText: raw.audioToText !== false,
    trainingEnabled: {
      text: rawTrainingEnabled.text !== false,
      images: rawTrainingEnabled.images === true,
      video: rawTrainingEnabled.video === true,
      pdf: rawTrainingEnabled.pdf === true,
    },
    responseScope: RESPONSE_SCOPES.has(responseScope) ? responseScope : "tagged",
    selectedLabelIds: Array.isArray(raw.selectedLabelIds)
      ? raw.selectedLabelIds.map((id) => Number(id)).filter(Number.isFinite).slice(0, 100)
      : [],
    textRules,
    assets: {
      images: normalizeAssets("images"),
      video: normalizeAssets("video"),
      pdf: normalizeAssets("pdf"),
    },
  };
}

function serializeSettings(row: {
  enabled: boolean;
  model: string;
  openAiApiKeyEncrypted: string | null;
  trainingConfig: AgentTrainingConfig;
} | null) {
  return {
    enabled: row?.enabled ?? false,
    configured: !!row?.openAiApiKeyEncrypted,
    apiKeyPreview: apiKeyPreview(row?.openAiApiKeyEncrypted),
    model: row?.model ?? DEFAULT_MODEL,
    trainingConfig: row?.trainingConfig ?? {},
  };
}

function modelsPayload(models: string[], configured: boolean, currentModel?: string | null) {
  const list = Array.from(new Set([currentModel, ...models].filter((model): model is string => !!model)));
  return {
    models: list.length > 0 ? list : DEFAULT_OPENAI_MODELS,
    configured,
  };
}

router.get("/agent-settings", async (req, res) => {
  const [row] = await db
    .select({
      enabled: agentSettingsTable.enabled,
      model: agentSettingsTable.model,
      openAiApiKeyEncrypted: agentSettingsTable.openAiApiKeyEncrypted,
      trainingConfig: agentSettingsTable.trainingConfig,
    })
    .from(agentSettingsTable)
    .where(eq(agentSettingsTable.userId, req.session.userId!));

  return res.json(serializeSettings(row ?? null));
});

router.get("/agent-settings/models", async (req, res) => {
  const [row] = await db
    .select({
      model: agentSettingsTable.model,
      openAiApiKeyEncrypted: agentSettingsTable.openAiApiKeyEncrypted,
    })
    .from(agentSettingsTable)
    .where(eq(agentSettingsTable.userId, req.session.userId!));

  const apiKey = decryptSecret(row?.openAiApiKeyEncrypted);
  if (!apiKey) {
    return res.json(modelsPayload(DEFAULT_OPENAI_MODELS, false, row?.model ?? DEFAULT_MODEL));
  }

  try {
    const models = await listOpenAiModels(apiKey);
    return res.json(modelsPayload(models, true, row?.model ?? DEFAULT_MODEL));
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }
});

router.post("/agent-settings/models", async (req, res) => {
  const [row] = await db
    .select({
      model: agentSettingsTable.model,
      openAiApiKeyEncrypted: agentSettingsTable.openAiApiKeyEncrypted,
    })
    .from(agentSettingsTable)
    .where(eq(agentSettingsTable.userId, req.session.userId!));

  const rawKey = cleanString(req.body?.openAiApiKey, 300);
  const apiKey = rawKey || decryptSecret(row?.openAiApiKeyEncrypted);
  if (!apiKey) {
    return res.json(modelsPayload(DEFAULT_OPENAI_MODELS, false, row?.model ?? DEFAULT_MODEL));
  }

  try {
    const models = await listOpenAiModels(apiKey);
    return res.json(modelsPayload(models, true, row?.model ?? DEFAULT_MODEL));
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }
});

router.patch("/agent-settings", uploadAgentTrainingFiles.any(), async (req, res) => {
  const userId = req.session.userId!;
  const [existing] = await db
    .select()
    .from(agentSettingsTable)
    .where(eq(agentSettingsTable.userId, userId));

  const payload = parseSettingsPayload(req.body);
  const rawKey = cleanString(payload.openAiApiKey, 300);
  const enabled = payload.enabled === true;
  const requestedModel = cleanString(payload.model, 120);
  const model = requestedModel || existing?.model || DEFAULT_MODEL;
  let encryptedKey = existing?.openAiApiKeyEncrypted ?? null;

  if (rawKey) {
    await validateOpenAiKey(rawKey, model);
    encryptedKey = encryptSecret(rawKey);
  } else if (enabled && encryptedKey && (model !== existing?.model || existing.enabled !== true)) {
    const existingKey = decryptSecret(encryptedKey);
    if (!existingKey) {
      return res.status(400).json({ error: "La API key guardada no se pudo leer. Pega una nueva key." });
    }
    await validateOpenAiKey(existingKey, model);
  }

  if (enabled && !encryptedKey) {
    return res.status(400).json({ error: "Pega tu API key de OpenAI para activar el agente" });
  }

  const trainingConfig = normalizeTrainingConfig(
    payload.trainingConfig,
    filesByField(req.files),
    (existing?.trainingConfig ?? {}) as AgentTrainingConfig,
  );

  const [saved] = await db
    .insert(agentSettingsTable)
    .values({
      userId,
      enabled,
      model,
      openAiApiKeyEncrypted: encryptedKey,
      trainingConfig,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: agentSettingsTable.userId,
      set: {
        enabled,
        model,
        openAiApiKeyEncrypted: encryptedKey,
        trainingConfig,
        updatedAt: new Date(),
      },
    })
    .returning({
      enabled: agentSettingsTable.enabled,
      model: agentSettingsTable.model,
      openAiApiKeyEncrypted: agentSettingsTable.openAiApiKeyEncrypted,
      trainingConfig: agentSettingsTable.trainingConfig,
    });

  return res.json(serializeSettings(saved));
});

export default router;
