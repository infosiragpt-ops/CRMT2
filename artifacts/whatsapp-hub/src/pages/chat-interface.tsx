import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, isToday, isYesterday } from "date-fns";
import { useSocket } from "@/lib/socket-context";
import { useAuth } from "@/lib/auth-context";
import {
  readCachedChats,
  readCachedMessages,
  writeCachedChats,
  writeCachedMessages,
} from "@/lib/chat-persistent-cache";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowUp,
  Ban,
  Briefcase,
  Calendar,
  Camera,
  Check,
  CheckCheck,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Contact,
  Copy,
  CornerUpLeft,
  Download,
  Eraser,
  File as FileIcon,
  FileText,
  Flag,
  Forward,
  Folder,
  Headphones,
  Image,
  Info,
  List,
  Lock,
  LogOut,
  MailPlus,
  MessageCircle,
  MessageSquare,
  Mic,
  MoreVertical,
  Package,
  Paperclip,
  Pencil,
  Pin,
  Play,
  Plus,
  Search,
  Send,
  Settings,
  ShoppingBag,
  Smile,
  Star,
  Sticker,
  Tag,
  Tags,
  Trash2,
  User,
  Users,
  Video,
  VolumeX,
  X,
  XCircle,
  Zap,
  Link2,
  Loader2,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

type ChatLabel = { id: number; name: string; color: string };
type PhoneCodeSource = "whatsapp-id" | "lid-resolution" | "contact";
type ChatParticipant = {
  id: string;
  name?: string | null;
  phoneNumber?: string | null;
  phoneCode?: string | null;
  phoneCodeVerified?: boolean;
  phoneCodeSource?: PhoneCodeSource | null;
  isAdmin?: boolean;
};
type GroupParticipantsResponse = {
  participants: ChatParticipant[];
  source: "whatsapp" | "unavailable";
};
type Collaborator = {
  id: number;
  username: string;
  displayName: string;
  role: "admin" | "user";
  labelColor?: string;
  permissions?: CollaboratorPermissions;
  createdAt: string;
  online?: boolean;
  unreadInternalCount?: number;
};

type ChatAssignment = {
  userId: number;
  username: string;
  displayName: string;
  color: string;
  assignedByUserId?: number | null;
  assignedAt: string;
};

type CollaboratorPermissions = {
  canReply: boolean;
  canSendMedia: boolean;
  canUseQuickReplies: boolean;
  canManageQuickReplies: boolean;
  canManageLabels: boolean;
  canManageChats: boolean;
};

const DEFAULT_COLLABORATOR_PERMISSIONS: CollaboratorPermissions = {
  canReply: true,
  canSendMedia: true,
  canUseQuickReplies: true,
  canManageQuickReplies: true,
  canManageLabels: true,
  canManageChats: true,
};

const COLLABORATOR_COLOR_OPTIONS = [
  "#00a884",
  "#22c55e",
  "#0ea5e9",
  "#6366f1",
  "#a855f7",
  "#f59e0b",
  "#ef4444",
  "#14b8a6",
];

const collaboratorPermissionOptions: {
  key: keyof CollaboratorPermissions;
  title: string;
  description: string;
}[] = [
  {
    key: "canReply",
    title: "Responder mensajes",
    description: "Enviar respuestas de texto en conversaciones.",
  },
  {
    key: "canSendMedia",
    title: "Enviar archivos",
    description: "Adjuntar imagenes, videos, documentos y audios.",
  },
  {
    key: "canUseQuickReplies",
    title: "Usar respuestas rapidas",
    description: "Enviar plantillas guardadas desde el chat.",
  },
  {
    key: "canManageQuickReplies",
    title: "Administrar respuestas",
    description: "Crear, editar o eliminar respuestas rapidas.",
  },
  {
    key: "canManageLabels",
    title: "Administrar etiquetas",
    description: "Crear etiquetas y asignarlas a conversaciones.",
  },
  {
    key: "canManageChats",
    title: "Organizar chats",
    description: "Archivar, fijar, silenciar y marcar conversaciones.",
  },
];

type AgentTrainingKind = "text" | "images" | "video" | "pdf";
type AgentMediaTrainingKind = Exclude<AgentTrainingKind, "text">;
type AgentResponseScope = "tagged" | "notTagged" | "all" | "exceptTagged";

type AgentTextRule = {
  id: string;
  trigger: string;
  response: string;
};

type AgentTrainingAsset = {
  id: string;
  file: File;
  trigger: string;
};

type SavedAgentTrainingAsset = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  trigger: string;
  uploadField?: string;
};

type AgentTrainingConfigPayload = {
  voiceReplies: boolean;
  audioToText: boolean;
  trainingEnabled: Record<AgentTrainingKind, boolean>;
  responseScope: AgentResponseScope;
  selectedLabelIds: number[];
  textRules: Array<{ trigger: string; response: string }>;
  assets: Record<AgentMediaTrainingKind, SavedAgentTrainingAsset[]>;
};

type AgentSettingsResponse = {
  enabled: boolean;
  configured: boolean;
  apiKeyPreview?: string | null;
  model: string;
  trainingConfig?: Partial<AgentTrainingConfigPayload>;
};

type AgentModelsResponse = {
  models: string[];
  configured: boolean;
};

const DEFAULT_AGENT_MODEL = "gpt-4.1-mini";
const DEFAULT_AGENT_MODELS = [
  DEFAULT_AGENT_MODEL,
  "gpt-4.1",
  "gpt-4o-mini",
  "gpt-4o",
  "o4-mini",
  "o3-mini",
  "o3",
];
const MESSAGE_CACHE_STALE_MS = 60_000;
const MESSAGE_CACHE_GC_MS = 30 * 60_000;

const agentTrainingCards: {
  key: AgentTrainingKind;
  title: string;
  description: string;
  accept: string;
}[] = [
  {
    key: "text",
    title: "Texto",
    description: "Guiones, condiciones, precios y respuestas base.",
    accept: ".txt,.md,.csv,.json",
  },
  {
    key: "images",
    title: "Imágenes",
    description: "Fotos de productos, comprobantes y referencias visuales.",
    accept: "image/*",
  },
  {
    key: "video",
    title: "Video",
    description: "Demostraciones, tutoriales y respuestas con video.",
    accept: "video/*",
  },
  {
    key: "pdf",
    title: "PDF",
    description: "Catálogos, contratos, políticas y fichas técnicas.",
    accept: ".pdf",
  },
];

const agentResponseScopeOptions: {
  key: AgentResponseScope;
  title: string;
  description: string;
}[] = [
  {
    key: "tagged",
    title: "Responder a chats etiquetados",
    description: "Solo atiende los chats con las etiquetas elegidas.",
  },
  {
    key: "notTagged",
    title: "No responder a chats etiquetados",
    description: "Ignora cualquier chat que tenga etiqueta.",
  },
  {
    key: "all",
    title: "Responder a todos",
    description: "El agente atiende todos los chats entrantes.",
  },
  {
    key: "exceptTagged",
    title: "Responder a todos excepto etiquetados",
    description: "Atiende todos menos los chats con las etiquetas elegidas.",
  },
];

function localId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function restoreTextRules(value: unknown): AgentTextRule[] {
  const rules = Array.isArray(value) ? value : [];
  return rules
    .map((rule) => {
      const raw = rule && typeof rule === "object" ? (rule as Record<string, unknown>) : {};
      return {
        id: localId("rule"),
        trigger: typeof raw.trigger === "string" ? raw.trigger : "",
        response: typeof raw.response === "string" ? raw.response : "",
      };
    })
    .filter((rule) => rule.trigger || rule.response);
}

function normalizeCollaboratorPermissions(value: unknown): CollaboratorPermissions {
  const raw = value && typeof value === "object" ? (value as Partial<CollaboratorPermissions>) : {};
  return {
    ...DEFAULT_COLLABORATOR_PERMISSIONS,
    ...Object.fromEntries(
      Object.keys(DEFAULT_COLLABORATOR_PERMISSIONS).map((key) => [
        key,
        typeof raw[key as keyof CollaboratorPermissions] === "boolean"
          ? raw[key as keyof CollaboratorPermissions]
          : DEFAULT_COLLABORATOR_PERMISSIONS[key as keyof CollaboratorPermissions],
      ]),
    ),
  } as CollaboratorPermissions;
}

type Chat = {
  id: string;
  name: string;
  customName?: string | null;
  isGroup: boolean;
  participants?: ChatParticipant[];
  unreadCount: number;
  timestamp: number;
  lastMessage: ({ body: string; hasMedia?: boolean; type?: string } & Partial<Message>) | string | null;
  archived: boolean;
  favorited: boolean;
  pinned: boolean;
  muted: boolean;
  emailNotifications: boolean;
  manuallyUnread: boolean;
  labels: ChatLabel[];
  assignedTo?: ChatAssignment | null;
  phoneNumber?: string | null;
  phoneCode?: string | null;
  phoneCodeVerified?: boolean;
  phoneCodeSource?: PhoneCodeSource | null;
  profilePicUrl?: string | null;
  profilePicLookupUrl?: string | null;
};

type Message = {
  id: string;
  chatId: string;
  from: string;
  to: string;
  body: string;
  fromMe: boolean;
  timestamp: number;
  hasMedia: boolean;
  type: string;
  author?: string;
  ack?: number | null;
  isForwarded?: boolean;
  isStarred?: boolean;
  hasReaction?: boolean;
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
  mediaFileName?: string | null;
  quotedMessageId?: string | null;
  quotedBody?: string | null;
  quotedParticipant?: string | null;
  quotedFromMe?: boolean | null;
  info?: MessageInfoPayload | null;
};

type MessageQuotePreview = {
  body: string;
  authorLabel: string;
  fromMe?: boolean | null;
};

type SendMessageVariables = {
  chatId: string;
  body: string;
  quotedMessageId?: string;
  optimisticId: string;
  quotedPreview?: MessageQuotePreview;
};

type SendMessageContext = {
  previousMessages?: Message[];
  previousChats?: Chat[];
  optimisticId: string;
  chatId: string;
  body: string;
};

type MessageReceipt = { id?: { _serialized?: string; user?: string } | string; t?: number };

type MessageInfoPayload = {
  delivery: MessageReceipt[];
  deliveryRemaining: number;
  read: MessageReceipt[];
  readRemaining: number;
  played: MessageReceipt[];
  playedRemaining: number;
};

type QuickReply = {
  id: number;
  shortcut: string;
  title: string;
  body: string;
  attachments: {
    id: number;
    kind: string;
    fileName: string;
    mimeType: string;
    url: string;
  }[];
};

type ChatNote = {
  id: number;
  body: string;
  fileName: string | null;
  fileUrl: string | null;
  fileMimeType: string | null;
  fileSizeBytes: number | null;
  createdAt: string;
  authorDisplayName: string;
  authorUsername: string;
};

type InternalTeamMessage = {
  id: number;
  senderUserId: number;
  recipientUserId: number;
  body: string;
  fileName: string | null;
  fileUrl: string | null;
  fileMimeType: string | null;
  fileSizeBytes: number | null;
  readAt: string | null;
  createdAt: string;
  senderDisplayName: string;
  senderUsername: string;
};

type SendTeamMessageContext = {
  peerUserId: number;
  previousMessages?: InternalTeamMessage[];
  optimisticIds: number[];
  objectUrls: string[];
  previousInput: string;
  previousFiles: File[];
};

type SendTeamMessageVariables = {
  recipientUser: Collaborator;
  body: string;
  files: File[];
};

type DownloadedMessageMedia = {
  data: string;
  mimetype: string;
  filename: string | null;
  filesize: number | null;
};

function lastMessageText(m: Chat["lastMessage"]): string {
  if (!m) return "";
  const raw = typeof m === "string" ? m : m.body || "";
  if (!raw && typeof m !== "string" && m.hasMedia) {
    if (m.type === "image" || m.mediaMimeType?.startsWith("image/")) return "Foto";
    if (m.type === "video" || m.mediaMimeType?.startsWith("video/")) return "Video";
    if (m.type === "audio" || m.mediaMimeType?.startsWith("audio/")) return "Audio";
    return "Documento";
  }
  return sanitizePreview(raw);
}

function lastMessageFromMe(m: Chat["lastMessage"]) {
  return typeof m !== "string" && !!m?.fromMe;
}

function looksLikeEncodedMedia(value: string) {
  const text = value.trim();
  if (!text) return false;
  if (text.startsWith("data:image/") || text.startsWith("data:application/")) return true;
  if (text.startsWith("iVBOR") || text.startsWith("/9j/") || text.startsWith("JVBER")) return true;
  return text.length > 260 && /^[A-Za-z0-9+/=\s]+$/.test(text.slice(0, 260));
}

function sanitizePreview(value: string) {
  const text = value.trim();
  if (!text) return "";
  if (looksLikeEncodedMedia(text)) return text.startsWith("JVBER") ? "Documento" : "Foto";
  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

function splitLegacyReplyBody(value: string) {
  const match = value.match(/^>\s*([^\n]+)\n([\s\S]+)$/);
  if (!match) return null;
  return { quotedBody: match[1].trim(), body: match[2].trim() };
}

function visibleMessageBody(value: string) {
  return splitLegacyReplyBody(value)?.body ?? value;
}

function searchableMessageText(message: Message) {
  return [
    visibleMessageBody(message.body || ""),
    message.quotedBody || "",
    message.mediaFileName || "",
    message.mediaMimeType || "",
    message.type || "",
  ]
    .filter(Boolean)
    .join(" ");
}

function savedChatName(chat?: Pick<Chat, "customName"> | null) {
  return chat?.customName?.trim() || "";
}

function displayChatName(chat?: Pick<Chat, "name" | "id" | "customName"> | null) {
  if (!chat) return "";
  return savedChatName(chat) || chat.name || chat.id.replace(/@c\.us|@g\.us|@lid|@s\.whatsapp\.net/g, "");
}

function digitsFromText(value?: string | null) {
  return (value || "").replace(/\D/g, "");
}

function formatSixDigitCode(value: string) {
  const digits = digitsFromText(value).slice(-6);
  if (digits.length !== 6) return value;
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}

function trustedDigitsFromWaId(value?: string | null) {
  if (!value) return "";
  const [user, server] = value.trim().split("@");
  if (!user || !server) return "";
  if (server !== "c.us" && server !== "s.whatsapp.net") return "";
  const digits = digitsFromText(user);
  return digits.length >= 6 ? digits : "";
}

function verifiedPhoneDigits(value?: string | null) {
  const digits = digitsFromText(value);
  return digits.length >= 6 ? digits : "";
}

function verifiedChatDigits(
  chat?: Pick<Chat, "id" | "isGroup" | "phoneNumber" | "phoneCode" | "phoneCodeVerified"> | null,
) {
  if (!chat || chat.isGroup) return "";
  const idDigits = trustedDigitsFromWaId(chat.id);
  if (idDigits) return idDigits;
  if (!chat.phoneCodeVerified) return "";
  const phoneDigits = verifiedPhoneDigits(chat.phoneNumber);
  if (phoneDigits) return phoneDigits;
  const codeDigits = verifiedPhoneDigits(chat.phoneCode);
  return codeDigits.length === 6 ? codeDigits : "";
}

function verifiedParticipantDigits(participant: ChatParticipant) {
  const idDigits = trustedDigitsFromWaId(participant.id);
  if (idDigits) return idDigits;
  if (!participant.phoneCodeVerified) return "";
  const phoneDigits = verifiedPhoneDigits(participant.phoneNumber);
  if (phoneDigits) return phoneDigits;
  const codeDigits = verifiedPhoneDigits(participant.phoneCode);
  return codeDigits.length === 6 ? codeDigits : "";
}

function displayChatCode(
  chat?: Pick<Chat, "name" | "id" | "customName" | "isGroup" | "phoneNumber" | "phoneCode" | "phoneCodeVerified"> | null,
) {
  if (!chat) return "";
  if (chat.isGroup) return displayChatName(chat);
  const digits = verifiedChatDigits(chat);
  return digits ? formatSixDigitCode(digits) : "Sin codigo verificado";
}

function displayChatTitle(
  chat?: Pick<Chat, "name" | "id" | "customName" | "isGroup" | "phoneNumber" | "phoneCode" | "phoneCodeVerified"> | null,
) {
  return savedChatName(chat) || displayChatCode(chat);
}

function copyableChatCode(
  chat?: Pick<Chat, "id" | "isGroup" | "phoneNumber" | "phoneCode" | "phoneCodeVerified"> | null,
) {
  const digits = verifiedChatDigits(chat);
  if (!digits) return "";
  return formatSixDigitCode(digits);
}

function initials(name: string) {
  const clean = name.trim();
  if (!clean) return "?";
  if (clean.startsWith("+")) return clean.replace(/\D/g, "").slice(-2) || "?";
  return clean
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function formatChatTime(timestamp?: number) {
  if (!timestamp) return "";
  const date = new Date(timestamp * 1000);
  if (isToday(date)) return format(date, "h:mm a").replace("AM", "a. m.").replace("PM", "p. m.");
  if (isYesterday(date)) return "Ayer";
  return format(date, "dd/MM/yy");
}

function formatDateTimeLabel(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  if (isToday(date)) return format(date, "h:mm a").replace("AM", "a. m.").replace("PM", "p. m.");
  if (isYesterday(date)) return `Ayer ${format(date, "h:mm a").replace("AM", "a. m.").replace("PM", "p. m.")}`;
  return format(date, "dd/MM/yy h:mm a").replace("AM", "a. m.").replace("PM", "p. m.");
}

function formatMessageTime(timestamp?: number) {
  if (!timestamp) return "";
  return format(new Date(timestamp * 1000), "h:mm a").replace("AM", "a. m.").replace("PM", "p. m.");
}

function formatReceiptTime(timestamp?: number) {
  if (!timestamp) return "";
  return format(new Date(timestamp * 1000), "dd/MM h:mm a").replace("AM", "a. m.").replace("PM", "p. m.");
}

function labelColor(label?: ChatLabel) {
  return label?.color || "#f5bd31";
}

function closeMenus(...setters: Array<(value: boolean) => void>) {
  setters.forEach((setter) => setter(false));
}

const blockedPhoneNumberMessage =
  "Por seguridad no se puede enviar números de teléfono desde el CRM.";

function containsBlockedPhoneNumber(value: string) {
  const candidates: string[] = value.match(/\b(?:\d[\s.-]?){9}\b/g) || [];
  return candidates.some((candidate) => candidate.replace(/\D/g, "").length === 9);
}

let notificationAudioContext: AudioContext | null = null;
let lastNotificationSoundAt = 0;
const profilePicUrlCache = new Map<string, { url: string | null; expiresAt: number }>();
const profilePicRequestCache = new Map<string, Promise<string | null>>();

function getNotificationAudioContext() {
  const AudioContextClass =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  notificationAudioContext ??= new AudioContextClass();
  return notificationAudioContext;
}

function unlockNotificationSound() {
  const audioContext = getNotificationAudioContext();
  if (audioContext?.state === "suspended") {
    void audioContext.resume().catch(() => undefined);
  }
}

function playIncomingMessageSound() {
  const nowMs = Date.now();
  if (nowMs - lastNotificationSoundAt < 650) return;
  lastNotificationSoundAt = nowMs;

  const audioContext = getNotificationAudioContext();
  if (!audioContext) return;

  void audioContext.resume().then(() => {
    const start = audioContext.currentTime;
    const gain = audioContext.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.035, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);
    gain.connect(audioContext.destination);

    [880, 1175].forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, start + index * 0.07);
      oscillator.connect(gain);
      oscillator.start(start + index * 0.07);
      oscillator.stop(start + index * 0.07 + 0.13);
    });
  }).catch(() => undefined);
}

async function resolveProfilePicUrl(lookupUrl: string, forceRefresh = false) {
  const now = Date.now();
  const cached = profilePicUrlCache.get(lookupUrl);
  if (!forceRefresh && cached && cached.expiresAt > now) return cached.url;
  let request = profilePicRequestCache.get(lookupUrl);
  if (!request) {
    const url = forceRefresh ? `${lookupUrl}${lookupUrl.includes("?") ? "&" : "?"}refresh=1` : lookupUrl;
    request = fetch(url, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) return null;
        const data = (await res.json()) as { profilePicUrl?: string | null };
        return data.profilePicUrl ?? null;
      })
      .catch(() => null)
      .then((url) => {
        profilePicUrlCache.set(lookupUrl, {
          url,
          expiresAt: Date.now() + (url ? 60 * 60_000 : 10_000),
        });
        profilePicRequestCache.delete(lookupUrl);
        return url;
      });
    profilePicRequestCache.set(lookupUrl, request);
  }
  return request;
}

function fileNameFromMessage(msg: Message) {
  if (msg.mediaFileName) return msg.mediaFileName;
  const body = sanitizePreview(msg.body || "");
  if (/\.[a-z0-9]{2,6}$/i.test(body)) return body;
  if (msg.type === "image" || msg.mediaMimeType?.startsWith("image/")) return "Foto";
  if (msg.type === "video" || msg.mediaMimeType?.startsWith("video/")) return "Video";
  if (msg.type === "audio" || msg.mediaMimeType?.startsWith("audio/")) return "Audio";
  return "Documento";
}

function triggerDownload(href: string, fileName: string) {
  const link = document.createElement("a");
  link.href = href;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function messageActionText(msg: Message) {
  const cleanBody = sanitizePreview(visibleMessageBody(msg.body || ""));
  if (cleanBody) return cleanBody;
  if (msg.hasMedia || msg.mediaUrl) {
    const name = fileNameFromMessage(msg);
    return msg.mediaUrl ? `${name}\n${msg.mediaUrl}` : name;
  }
  return "Mensaje";
}

function messageNoteText(msg: Message) {
  const direction = msg.fromMe ? "Enviado desde CRM" : "Recibido";
  return `${direction} ${formatMessageTime(msg.timestamp)}\n${messageActionText(msg)}`;
}

function fileExtension(name: string) {
  if (/^(foto|imagen)$/i.test(name)) return "IMG";
  if (/^video$/i.test(name)) return "VID";
  if (/^audio$/i.test(name)) return "AUD";
  const match = name.match(/\.([a-z0-9]{2,6})$/i);
  return match?.[1]?.toUpperCase() || "DOC";
}

function fileBadge(name: string, mimeType?: string | null) {
  const lower = `${name} ${mimeType || ""}`.toLowerCase();
  if (lower.includes("foto") || lower.includes("imagen") || lower.includes("image/")) {
    return { label: "IMG", color: "bg-[#3f8f72]" };
  }
  if (lower.includes("video") || lower.includes("video/")) {
    return { label: "VID", color: "bg-[#7d5bd1]" };
  }
  if (lower.includes("audio") || lower.includes("audio/")) {
    return { label: "AUD", color: "bg-[#e96b45]" };
  }
  if (lower.includes("spreadsheet") || lower.includes(".xls") || lower.includes("excel")) {
    return { label: "X", color: "bg-[#1f8f4d]" };
  }
  if (lower.includes("text/csv") || lower.includes(".csv")) {
    return { label: "CSV", color: "bg-[#6b7280]" };
  }
  if (lower.includes("presentation") || lower.includes(".ppt")) {
    return { label: "P", color: "bg-[#f97316]" };
  }
  if (lower.includes("pdf") || lower.includes(".pdf")) {
    return { label: "PDF", color: "bg-[#d4483f]" };
  }
  if (lower.includes("word") || lower.includes(".doc")) {
    return { label: "W", color: "bg-[#2f65c8]" };
  }
  return { label: fileExtension(name).slice(0, 3), color: "bg-[#607d8b]" };
}

function formatFileSize(bytes?: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

const audioRecordingMimeTypes = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
];

function supportedAudioRecordingMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  return audioRecordingMimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || "";
}

function audioExtensionForMime(mimeType: string) {
  if (mimeType.includes("ogg")) return ".ogg";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return ".m4a";
  if (mimeType.includes("mpeg")) return ".mp3";
  if (mimeType.includes("wav")) return ".wav";
  return ".webm";
}

function formatAudioDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function formatNoteTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return format(date, "dd/MM HH:mm");
}

function noteFileKind(note: Pick<ChatNote, "fileName" | "fileMimeType">) {
  const value = `${note.fileMimeType || ""} ${note.fileName || ""}`.toLowerCase();
  if (value.includes("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(value)) return "image";
  if (value.includes("video/") || /\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(value)) return "video";
  if (value.includes("pdf") || /\.pdf$/i.test(value)) return "pdf";
  if (value.includes("text/") || /\.(txt|csv|json|md)$/i.test(value)) return "text";
  return "document";
}

function isImageFile(file: File) {
  return file.type.startsWith("image/");
}

function isVideoFile(file: File) {
  return file.type.startsWith("video/");
}

function isImageMessage(msg: Message) {
  return msg.type === "image" || !!msg.mediaMimeType?.startsWith("image/");
}

function isVideoMessage(msg: Message) {
  return msg.type === "video" || !!msg.mediaMimeType?.startsWith("video/");
}

function isDocumentMessage(msg: Message) {
  if (!msg.hasMedia) return false;
  return !isImageMessage(msg) && !isVideoMessage(msg) && !msg.mediaMimeType?.startsWith("audio/");
}

function isVisualMediaMessage(msg: Message) {
  return isImageMessage(msg) || isVideoMessage(msg);
}

function isChatMuted(chats: Chat[] | undefined, chatId?: string | null) {
  return !!chatId && !!chats?.find((chat) => chat.id === chatId)?.muted;
}

function extractLinks(text: string) {
  return Array.from(text.matchAll(/https?:\/\/[^\s<>"')]+/gi)).map((match) => match[0]);
}

function splitTextLinks(text: string) {
  const parts: Array<{ text: string; href?: string }> = [];
  const pattern = /https?:\/\/[^\s<>"']+/gi;
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const rawUrl = match[0];
    const start = match.index ?? 0;
    if (start > lastIndex) parts.push({ text: text.slice(lastIndex, start) });

    const trailing = rawUrl.match(/[.,!?;:)\]]+$/)?.[0] ?? "";
    const cleanUrl = trailing ? rawUrl.slice(0, -trailing.length) : rawUrl;
    if (cleanUrl) {
      parts.push({ text: cleanUrl, href: cleanUrl });
    }
    if (trailing) parts.push({ text: trailing });
    lastIndex = start + rawUrl.length;
  }
  if (lastIndex < text.length) parts.push({ text: text.slice(lastIndex) });
  return parts.length > 0 ? parts : [{ text }];
}

function LinkifiedText({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={className}>
      {splitTextLinks(text).map((part, index) =>
        part.href ? (
          <a
            key={`${part.href}-${index}`}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="font-medium text-[#0675d8] underline underline-offset-2 hover:text-[#005cbb]"
          >
            {part.text}
          </a>
        ) : (
          <span key={`${part.text}-${index}`}>{part.text}</span>
        ),
      )}
    </div>
  );
}

function linkHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function DocumentPreview({
  name,
  mimeType,
  href,
  compact = false,
}: {
  name: string;
  mimeType?: string | null;
  href?: string | null;
  compact?: boolean;
}) {
  const badge = fileBadge(name, mimeType);
  const content = (
    <div
      className={`flex items-center gap-3 rounded-lg bg-black/[0.04] ${
        compact ? "min-w-[220px] p-2" : "min-w-[280px] max-w-[400px] p-3"
      }`}
    >
      <div
        className={`grid shrink-0 place-items-center rounded-md text-[12px] font-bold text-white ${badge.color} ${
          compact ? "h-9 w-8" : "h-11 w-9"
        }`}
      >
        {badge.label}
      </div>
      <div className="min-w-0 flex-1">
        <div className={`${compact ? "text-[14px]" : "text-[16px]"} truncate font-semibold text-[#111b21]`}>
          {name}
        </div>
        <div className="text-[12px] uppercase text-[#667781]">{fileExtension(name)}</div>
      </div>
      {href ? (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#aebac1] text-[#667781]">
          <Download className="h-5 w-5" />
        </span>
      ) : null}
    </div>
  );

  if (!href) return content;
  return (
    <a href={href} target="_blank" rel="noreferrer" download={name} className="block">
      {content}
    </a>
  );
}

function AudioPreview({ src }: { src: string; name: string }) {
  return (
    <div className="min-w-[250px] max-w-[390px] rounded-lg bg-black/[0.035] px-2 py-1.5">
      <audio src={src} controls preload="metadata" className="h-9 w-full align-middle" />
    </div>
  );
}

function VideoPreview({
  src,
  time,
  fromMe,
  compact = false,
}: {
  src: string;
  time?: string;
  fromMe?: boolean;
  compact?: boolean;
}) {
  const video = (
    <>
      <video
        src={src}
        preload="metadata"
        muted
        playsInline
        className={`${compact ? "h-full w-full" : "max-h-[460px] w-full max-w-[430px]"} object-cover`}
      />
      {!compact ? (
        <>
          <span className="absolute inset-0 grid place-items-center">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-black/45 text-white">
              <Play className="ml-1 h-8 w-8 fill-current" />
            </span>
          </span>
          <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/45 px-2 py-1 text-[11px] font-semibold leading-none text-white">
            <Video className="h-3.5 w-3.5 fill-current" />
            0:01
          </span>
          {time ? (
            <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-black/45 px-2 py-1 text-[11px] font-semibold leading-none text-white">
              {time}
              {fromMe ? <CheckCheck className="h-3.5 w-3.5" /> : null}
            </span>
          ) : null}
        </>
      ) : (
        <span className="absolute inset-0 grid place-items-center text-white">
          <Play className="h-7 w-7 fill-current drop-shadow" />
        </span>
      )}
    </>
  );

  if (compact) {
    return (
      <div className="relative block aspect-square overflow-hidden rounded-md bg-black">
        {video}
      </div>
    );
  }

  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      className={`relative block overflow-hidden bg-black ${
        compact ? "aspect-square rounded-md" : "rounded-lg"
      }`}
    >
      {video}
    </a>
  );
}

const chatUploadExtensions = new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "txt",
  "csv",
]);

function isAllowedUpload(file: File) {
  if (
    file.type.startsWith("image/") ||
    file.type.startsWith("video/") ||
    file.type.startsWith("audio/")
  ) {
    return true;
  }
  const ext = file.name.split(".").pop()?.toLowerCase();
  return !!ext && chatUploadExtensions.has(ext);
}

function appendUniqueMessages(old: Message[] = [], incoming: Message | Message[]) {
  const list = Array.isArray(incoming) ? incoming : [incoming];
  const next = [...old];
  for (const message of list) {
    if (!message?.id) continue;
    const existingIndex = next.findIndex((current) => current.id === message.id);
    if (existingIndex >= 0) {
      next[existingIndex] = { ...next[existingIndex], ...message };
      continue;
    }
    next.push(message);
  }
  return next;
}

function appendUniqueTeamMessages(old: InternalTeamMessage[] = [], incoming: InternalTeamMessage | InternalTeamMessage[]) {
  const list = Array.isArray(incoming) ? incoming : [incoming];
  const next = [...old];
  for (const message of list) {
    if (!message?.id) continue;
    const existingIndex = next.findIndex((current) => current.id === message.id);
    if (existingIndex >= 0) {
      next[existingIndex] = { ...next[existingIndex], ...message };
      continue;
    }
    next.push(message);
  }
  return next.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

function replaceMessageById(old: Message[] = [], replaceId: string, message: Message) {
  const withoutDuplicate = old.filter((current) => current.id !== message.id);
  const index = withoutDuplicate.findIndex((current) => current.id === replaceId);
  if (index < 0) return appendUniqueMessages(withoutDuplicate, message);
  const next = [...withoutDuplicate];
  next[index] = message;
  return next;
}

function PendingFileTile({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const badge = fileBadge(file.name, file.type);
  const previewKind = isImageFile(file) ? "image" : isVideoFile(file) ? "video" : null;

  useEffect(() => {
    if (!previewKind) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, previewKind]);

  if (previewUrl) {
    return (
      <div className="group relative h-28 w-28 shrink-0 overflow-hidden rounded-xl bg-[#111b21] shadow-sm">
        {previewKind === "image" ? (
          <img src={previewUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <>
            <video src={previewUrl} muted playsInline preload="metadata" className="h-full w-full object-cover" />
            <span className="absolute inset-0 grid place-items-center text-white">
              <Play className="h-7 w-7 fill-current drop-shadow" />
            </span>
          </>
        )}
        <button
          type="button"
          onClick={onRemove}
          className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/55 text-white opacity-90 hover:bg-black/70"
          aria-label="Quitar imagen"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="group relative flex h-16 min-w-[220px] max-w-[300px] items-center gap-3 rounded-xl border border-[#e4e7e8] bg-white px-3">
      <div className={`grid h-11 w-9 shrink-0 place-items-center rounded-md text-[11px] font-bold text-white ${badge.color}`}>
        {badge.label}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold text-[#111b21]">{file.name}</div>
        <div className="text-[12px] text-[#667781]">{fileExtension(file.name)}</div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[#667781] hover:bg-[#f0f2f5] hover:text-[#111b21]"
        aria-label="Quitar archivo"
      >
        <XCircle className="h-5 w-5" />
      </button>
    </div>
  );
}

async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    ...init,
    headers: { ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = text || res.statusText;
    try {
      const parsed = JSON.parse(text) as { error?: unknown };
      if (typeof parsed.error === "string") message = parsed.error;
    } catch {
      if (/<html[\s>]/i.test(text) || /bad gateway/i.test(text)) {
        message = "Servidor no disponible. Intenta nuevamente en unos segundos.";
      }
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

async function writeClipboardText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textArea);
  if (!copied) throw new Error("No se pudo copiar");
}

function AvatarBubble({
  name,
  isGroup,
  selected,
  imageSeed,
  imageUrl,
  profilePicLookupUrl,
  size = "md",
}: {
  name: string;
  isGroup?: boolean;
  selected?: boolean;
  imageSeed?: number;
  imageUrl?: string | null;
  profilePicLookupUrl?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
}) {
  const [resolvedImageUrl, setResolvedImageUrl] = useState(imageUrl ?? null);
  const [imageFailed, setImageFailed] = useState(false);
  const profilePicRetryRef = useRef(false);
  const palettes = [
    "bg-[#d9d0f6] text-[#6650ca]",
    "bg-[#d3e6ff] text-[#0b65c2]",
    "bg-[#f8d9cb] text-[#b45a42]",
    "bg-[#d8efe1] text-[#1f8c5d]",
  ];
  const palette = palettes[imageSeed ? imageSeed % palettes.length : 0];
  const sizeClass = size === "xs" ? "h-10 w-10" : size === "sm" ? "h-12 w-12" : size === "lg" ? "h-28 w-28" : "h-14 w-14";
  const iconClass = size === "xs" ? "h-5 w-5" : size === "sm" ? "h-6 w-6" : size === "lg" ? "h-12 w-12" : "h-7 w-7";
  const showImage = !!resolvedImageUrl && !imageFailed;

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    profilePicRetryRef.current = false;
    setResolvedImageUrl(imageUrl ?? null);
    setImageFailed(false);
    if (!imageUrl && profilePicLookupUrl) {
      const resolveWithRetry = (attempt: number) => {
        void resolveProfilePicUrl(profilePicLookupUrl, attempt > 0).then((url) => {
          if (cancelled) return;
          setResolvedImageUrl(url);
          if (!url && attempt < 3) {
            retryTimer = window.setTimeout(() => resolveWithRetry(attempt + 1), attempt === 0 ? 2500 : 7000);
          }
        });
      };
      resolveWithRetry(0);
    }
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [imageUrl, profilePicLookupUrl]);

  return (
    <div
      className={`relative grid ${sizeClass} shrink-0 place-items-center overflow-hidden rounded-full border ${
        selected ? "border-[#d9d9d9]" : "border-transparent"
      } ${palette}`}
    >
      {showImage ? (
        <img
          src={resolvedImageUrl}
          alt={name ? `Foto de ${name}` : "Foto de contacto"}
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => {
            if (profilePicLookupUrl && !profilePicRetryRef.current) {
              profilePicRetryRef.current = true;
              void resolveProfilePicUrl(profilePicLookupUrl, true).then((url) => {
                if (url) {
                  setResolvedImageUrl(`${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}`);
                  setImageFailed(false);
                } else {
                  setImageFailed(true);
                }
              });
              return;
            }
            setImageFailed(true);
          }}
        />
      ) : isGroup ? (
        <Users className={iconClass} />
      ) : (
        <User className={iconClass} />
      )}
      <span className="sr-only">{initials(name)}</span>
    </div>
  );
}

function RailButton({
  children,
  active,
  href,
  tooltip,
  badge,
  live,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  href?: string;
  tooltip: string;
  badge?: number;
  live?: boolean;
  onClick?: () => void;
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-label={tooltip}
      className={`relative grid h-[38px] w-[38px] place-items-center rounded-full text-[#5f6f77] transition-colors hover:bg-[#e6eaed] hover:text-[#111b21] ${
        active ? "bg-[#e6eaed] text-[#111b21]" : ""
      } ${
        live ? "agent-live-pulse bg-[#d9fdd3] text-[#008069]" : ""
      }`}
    >
      {children}
      {live ? (
        <span className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full border border-white bg-[#00c853] shadow-[0_0_10px_rgba(0,200,83,0.95)]" />
      ) : null}
      {badge ? (
        <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#0b8f6a] px-1 text-[11px] font-bold text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <Link href={href} className="block">
            {button}
          </Link>
        ) : (
          button
        )}
      </TooltipTrigger>
      <TooltipContent side="right">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export default function ChatInterface() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [, setLocation] = useLocation();
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "favorites" | "groups">("all");
	  const [showArchived, setShowArchived] = useState(false);
	  const [messageInput, setMessageInput] = useState("");
	  const [quickReplyOpen, setQuickReplyOpen] = useState(false);
	  const [quickReplyHighlightIndex, setQuickReplyHighlightIndex] = useState(0);
	  const [selectedLabelId, setSelectedLabelId] = useState<number | null>(null);
  const [labelMenuOpen, setLabelMenuOpen] = useState(false);
  const [appMenuOpen, setAppMenuOpen] = useState(false);
	  const [chatMenuOpen, setChatMenuOpen] = useState(false);
	  const [headerLabelsOpen, setHeaderLabelsOpen] = useState(false);
	  const [chatSearchOpen, setChatSearchOpen] = useState(false);
	  const [chatSearchQuery, setChatSearchQuery] = useState("");
	  const [activeSearchMatchIndex, setActiveSearchMatchIndex] = useState(0);
	  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
	  const [emojiOpen, setEmojiOpen] = useState(false);
	  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
	  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
	  const [audioRecordingSeconds, setAudioRecordingSeconds] = useState(0);
	  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [leftPanel, setLeftPanel] = useState<"chats" | "labels" | "quickReplies" | "team" | "settings">("chats");
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
  const [agentEnabled, setAgentEnabled] = useState(false);
  const [agentOpenAiApiKey, setAgentOpenAiApiKey] = useState("");
  const [agentModel, setAgentModel] = useState(DEFAULT_AGENT_MODEL);
  const [agentVoiceReplies, setAgentVoiceReplies] = useState(true);
  const [agentAudioToText, setAgentAudioToText] = useState(true);
  const [agentResponseScope, setAgentResponseScope] = useState<AgentResponseScope>("tagged");
  const [agentSelectedLabelIds, setAgentSelectedLabelIds] = useState<number[]>([]);
  const [agentTrainingEnabled, setAgentTrainingEnabled] = useState<Record<AgentTrainingKind, boolean>>({
    text: true,
    images: false,
    video: false,
    pdf: false,
  });
  const [agentTextRules, setAgentTextRules] = useState<AgentTextRule[]>([]);
  const [agentTextRuleEditor, setAgentTextRuleEditor] = useState<{
    mode: "create" | "edit";
    ruleId?: string;
    instructions: string;
  } | null>(null);
  const [agentTrainingAssets, setAgentTrainingAssets] = useState<
    Record<AgentMediaTrainingKind, AgentTrainingAsset[]>
  >({
    images: [],
    video: [],
    pdf: [],
  });
  const [quickReplyDialogOpen, setQuickReplyDialogOpen] = useState(false);
  const [quickReplyShortcut, setQuickReplyShortcut] = useState("");
  const [quickReplyTitle, setQuickReplyTitle] = useState("");
  const [quickReplyBody, setQuickReplyBody] = useState("");
  const [collaboratorName, setCollaboratorName] = useState("");
  const [collaboratorEmail, setCollaboratorEmail] = useState("");
  const [collaboratorPassword, setCollaboratorPassword] = useState("");
  const [collaboratorColor, setCollaboratorColor] = useState(COLLABORATOR_COLOR_OPTIONS[0]);
  const [permissionTargetId, setPermissionTargetId] = useState<number | null>(null);
  const [permissionDraft, setPermissionDraft] = useState<CollaboratorPermissions>(
    DEFAULT_COLLABORATOR_PERMISSIONS,
  );
  const [noteBody, setNoteBody] = useState("");
  const [noteFiles, setNoteFiles] = useState<File[]>([]);
  const [isDraggingNoteFiles, setIsDraggingNoteFiles] = useState(false);
  const [activeTeamUserId, setActiveTeamUserId] = useState<number | null>(null);
  const [teamMessageInput, setTeamMessageInput] = useState("");
  const [teamMessageFiles, setTeamMessageFiles] = useState<File[]>([]);
  const [isDraggingTeamFiles, setIsDraggingTeamFiles] = useState(false);
  const [imagePreview, setImagePreview] = useState<{ src: string; alt: string } | null>(null);
  const [notePreview, setNotePreview] = useState<ChatNote | null>(null);
  const [messageInfo, setMessageInfo] = useState<Message | null>(null);
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
  const [forwardMessage, setForwardMessage] = useState<Message | null>(null);
  const [forwardSearchQuery, setForwardSearchQuery] = useState("");
  const [openMessageMenuId, setOpenMessageMenuId] = useState<string | null>(null);
  const [messageReactions, setMessageReactions] = useState<Record<string, string>>({});
  const [pinnedMessageIds, setPinnedMessageIds] = useState<string[]>([]);
  const [starredMessageIds, setStarredMessageIds] = useState<string[]>([]);
  const [messagePinOverrides, setMessagePinOverrides] = useState<Record<string, boolean>>({});
  const [messageStarOverrides, setMessageStarOverrides] = useState<Record<string, boolean>>({});
  const [hiddenMessageIds, setHiddenMessageIds] = useState<string[]>([]);
  const [messageQuotePreviews, setMessageQuotePreviews] = useState<Record<string, MessageQuotePreview>>({});
  const [copiedChatCodeId, setCopiedChatCodeId] = useState<string | null>(null);
  const [detailsPanelOpen, setDetailsPanelOpen] = useState(false);
  const [mediaPanelOpen, setMediaPanelOpen] = useState(false);
  const [pendingPanelOpen, setPendingPanelOpen] = useState(false);
  const [assignmentTargetChat, setAssignmentTargetChat] = useState<Chat | null>(null);
  const [mediaPanelTab, setMediaPanelTab] = useState<"media" | "docs" | "links">("media");
  const { socket, connected: socketConnected } = useSocket();
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "admin";
  const currentPermissions = useMemo(
    () => (isAdmin ? DEFAULT_COLLABORATOR_PERMISSIONS : normalizeCollaboratorPermissions(user?.permissions)),
    [isAdmin, user?.permissions],
  );
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
	  const messageTextareaRef = useRef<HTMLTextAreaElement>(null);
	  const chatSearchInputRef = useRef<HTMLInputElement>(null);
	  const messageSearchRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
		  const mediaInputRef = useRef<HTMLInputElement>(null);
		  const noteFileInputRef = useRef<HTMLInputElement>(null);
		  const teamFileInputRef = useRef<HTMLInputElement>(null);
		  const teamMessagesEndRef = useRef<HTMLDivElement>(null);
		  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);
		  const seenSocketMessageIdsRef = useRef<Set<string>>(new Set());
		  const optimisticMessageSeqRef = useRef(0);
		  const agentSettingsAppliedRef = useRef(false);
	  const quickReplySlashOpenRef = useRef(false);
	  const clearMessageInputAfterQuickReplyRef = useRef(false);
	  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	  const audioStreamRef = useRef<MediaStream | null>(null);
	  const audioChunksRef = useRef<Blob[]>([]);
	  const audioRecordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	  const sendAudioAfterStopRef = useRef(false);
  const pageLoadStartedAtRef = useRef(
    typeof performance !== "undefined" ? performance.now() : Date.now(),
  );
  const chatListPerfLoggedRef = useRef(false);
  const activeMessagesPerfLoggedRef = useRef<Record<string, boolean>>({});

	  useEffect(() => {
	    const textarea = messageTextareaRef.current;
	    if (!textarea) return;

	    const minHeight = 24;
	    const maxHeight = 68;
	    textarea.style.height = "auto";
	    const nextHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
	    textarea.style.height = `${nextHeight}px`;
	    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
	  }, [messageInput]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    void readCachedChats<Chat>(sessionId).then((cached) => {
      if (cancelled || !cached?.value?.length) return;
      queryClient.setQueryData<Chat[]>(["chats", sessionId], (old) => old?.length ? old : cached.value);
    });
    return () => {
      cancelled = true;
    };
  }, [queryClient, sessionId]);

  const { data: devices } = useQuery({
    queryKey: ["devices"],
    queryFn: () => api<any[]>("/api/devices"),
    refetchInterval: 5_000,
  });

  const activeDevice = devices?.find((dev: any) => dev.sessionId === sessionId);
  const activeDeviceStatus = activeDevice?.liveStatus ?? activeDevice?.status ?? "starting";
  const isDeviceReady = activeDeviceStatus === "ready";
  const canLoadDeviceChats =
    !!sessionId &&
    !!activeDevice &&
    activeDeviceStatus !== "disconnected" &&
    activeDeviceStatus !== "auth_failure";
  const showDeviceSyncNotice = canLoadDeviceChats && !isDeviceReady;
  const deviceSyncText =
    activeDeviceStatus === "authenticated"
      ? "Conectado, sincronizando chats..."
      : "Preparando WhatsApp Web...";

	  const { data: chats, isLoading: isChatsLoading } = useQuery<Chat[]>({
	    queryKey: ["chats", sessionId],
	    queryFn: () => api<Chat[]>(`/api/devices/${sessionId}/chats`),
	    enabled: canLoadDeviceChats,
	    refetchInterval: socketConnected ? 30_000 : 5_000,
	    staleTime: socketConnected ? 25_000 : 4_000,
	    retry: false,
	  });

  useEffect(() => {
    if (!sessionId || !chats?.length) return;
    void writeCachedChats(sessionId, chats);
    if (!chatListPerfLoggedRef.current) {
      chatListPerfLoggedRef.current = true;
      const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - pageLoadStartedAtRef.current;
      if (elapsed > 1_000) {
        console.warn("[perf] La lista de chats tardó más de 1s en mostrarse", {
          sessionId,
          elapsedMs: Math.round(elapsed),
          chatCount: chats.length,
        });
      }
    }
  }, [chats, sessionId]);

  const { data: labels } = useQuery<ChatLabel[]>({
    queryKey: ["labels"],
    queryFn: () => api<ChatLabel[]>("/api/labels"),
  });

	  const { data: quickReplies } = useQuery<QuickReply[]>({
	    queryKey: ["quick-replies"],
	    queryFn: () => api<QuickReply[]>("/api/quick-replies"),
	  });

	  const quickReplyCommandActive = messageInput.startsWith("/");
	  const quickReplyCommandQuery = quickReplyCommandActive
	    ? messageInput.slice(1).trim().toLowerCase()
	    : "";
	  const visibleQuickReplies = useMemo(() => {
	    const replies = quickReplies ?? [];
	    if (!quickReplyCommandActive || !quickReplyCommandQuery) return replies;
	    return replies.filter((reply) => {
	      const haystack = [
	        reply.shortcut,
	        reply.title,
	        reply.body,
	        ...reply.attachments.map((attachment) => attachment.fileName),
	      ]
	        .filter(Boolean)
	        .join(" ")
	        .toLowerCase();
	      return haystack.includes(quickReplyCommandQuery);
	    });
	  }, [quickReplies, quickReplyCommandActive, quickReplyCommandQuery]);

	  const { data: collaborators } = useQuery<Collaborator[]>({
	    queryKey: ["collaborators"],
	    queryFn: () => api<Collaborator[]>("/api/collaborators"),
	    refetchInterval: 5_000,
	  });

	  const activeTeamUser = collaborators?.find((collaborator) => collaborator.id === activeTeamUserId) ?? null;

	  const { data: teamMessages, isLoading: isTeamMessagesLoading } = useQuery<InternalTeamMessage[]>({
	    queryKey: ["team-messages", activeTeamUserId],
	    queryFn: () => api<InternalTeamMessage[]>(`/api/team/messages?with=${activeTeamUserId}`),
	    enabled: !!activeTeamUserId,
	    refetchInterval: socketConnected ? false : activeTeamUserId ? 4_000 : false,
	    staleTime: MESSAGE_CACHE_STALE_MS,
	    placeholderData: () =>
	      activeTeamUserId
	        ? queryClient.getQueryData<InternalTeamMessage[]>(["team-messages", activeTeamUserId])
	        : undefined,
	  });
  const cachedTeamMessages = activeTeamUserId
    ? queryClient.getQueryData<InternalTeamMessage[]>(["team-messages", activeTeamUserId])
    : undefined;
  const displayedTeamMessages = teamMessages ?? cachedTeamMessages ?? [];
  const showTeamMessagesLoading = isTeamMessagesLoading && !displayedTeamMessages.length && !cachedTeamMessages;

  const { data: agentSettings } = useQuery<AgentSettingsResponse>({
    queryKey: ["agent-settings"],
    queryFn: () => api<AgentSettingsResponse>("/api/agent-settings"),
    enabled: isAdmin,
  });

  const { data: agentModels } = useQuery<AgentModelsResponse>({
    queryKey: ["agent-models"],
    queryFn: () => api<AgentModelsResponse>("/api/agent-settings/models"),
    enabled: isAdmin,
    retry: false,
  });

  const agentModelOptions = useMemo(() => {
    const source = agentModels?.models?.length ? agentModels.models : DEFAULT_AGENT_MODELS;
    const list = Array.from(new Set([agentModel, ...source].filter(Boolean)));
    return list.length > 0 ? list : DEFAULT_AGENT_MODELS;
  }, [agentModel, agentModels?.models]);

  const agentApiKeyPlaceholder = agentSettings?.apiKeyPreview
    ? `Guardada: ${agentSettings.apiKeyPreview}. Pega una nueva para cambiarla.`
    : agentSettings?.configured
      ? "Key guardada. Pega una nueva para cambiarla."
      : "sk-...";

  const permissionTarget = collaborators?.find((collaborator) => collaborator.id === permissionTargetId);

  const buildAgentTrainingConfig = (): AgentTrainingConfigPayload => ({
    voiceReplies: agentVoiceReplies,
    audioToText: agentAudioToText,
    trainingEnabled: agentTrainingEnabled,
    responseScope: agentResponseScope,
    selectedLabelIds: agentSelectedLabelIds,
    textRules: agentTextRules
      .map((rule) => ({ trigger: rule.trigger.trim(), response: rule.response.trim() }))
      .filter((rule) => rule.trigger || rule.response),
    assets: {
      images: agentTrainingAssets.images.map((asset, index) => ({
        fileName: asset.file.name,
        mimeType: asset.file.type,
        sizeBytes: asset.file.size,
        trigger: asset.trigger.trim(),
        uploadField: `images:${index}`,
      })),
      video: agentTrainingAssets.video.map((asset, index) => ({
        fileName: asset.file.name,
        mimeType: asset.file.type,
        sizeBytes: asset.file.size,
        trigger: asset.trigger.trim(),
        uploadField: `video:${index}`,
      })),
      pdf: agentTrainingAssets.pdf.map((asset, index) => ({
        fileName: asset.file.name,
        mimeType: asset.file.type,
        sizeBytes: asset.file.size,
        trigger: asset.trigger.trim(),
        uploadField: `pdf:${index}`,
      })),
    },
  });

  const hydratePersistedMessages = useCallback(
    async (chatId: string) => {
      if (!sessionId || !chatId) return false;
      const queryKey = ["messages", sessionId, chatId] as const;
      const current = queryClient.getQueryData<Message[]>(queryKey);
      if (current?.length) return true;
      const cached = await readCachedMessages<Message>(sessionId, chatId);
      if (!cached?.value?.length) return false;
      queryClient.setQueryData<Message[]>(queryKey, (old) => old?.length ? old : cached.value);
      return true;
    },
    [queryClient, sessionId],
  );

  const {
    data: messages,
    isLoading: isMessagesLoading,
    isError: isMessagesError,
    error: messagesError,
	  } = useQuery<Message[]>({
	    queryKey: ["messages", sessionId, activeChatId],
	    queryFn: () =>
	      api<Message[]>(
	        `/api/devices/${sessionId}/chats/${encodeURIComponent(activeChatId!)}/messages?limit=100`,
	      ),
	    enabled: !!sessionId && !!activeChatId,
	    refetchInterval: socketConnected ? false : 1_500,
	    staleTime: MESSAGE_CACHE_STALE_MS,
	    gcTime: MESSAGE_CACHE_GC_MS,
	    placeholderData: () =>
	      activeChatId
	        ? queryClient.getQueryData<Message[]>(["messages", sessionId, activeChatId])
	        : undefined,
	    refetchOnWindowFocus: false,
	    retry: false,
	  });

  const prefetchChatMessages = useCallback(
    (chatId: string) => {
      if (!sessionId || !chatId) return;
      const queryKey = ["messages", sessionId, chatId];
      if (queryClient.getQueryData<Message[]>(queryKey)) return;
      void hydratePersistedMessages(chatId).then((hydrated) => {
        if (hydrated || queryClient.getQueryData<Message[]>(queryKey)) return;
        void queryClient.prefetchQuery({
          queryKey,
          queryFn: () =>
            api<Message[]>(`/api/devices/${sessionId}/chats/${encodeURIComponent(chatId)}/messages?limit=100`),
          staleTime: MESSAGE_CACHE_STALE_MS,
          gcTime: MESSAGE_CACHE_GC_MS,
        });
      });
    },
    [hydratePersistedMessages, queryClient, sessionId],
  );

  useEffect(() => {
    if (!sessionId || !activeChatId) return;
    void hydratePersistedMessages(activeChatId);
  }, [activeChatId, hydratePersistedMessages, sessionId]);

  useEffect(() => {
    if (!sessionId || !activeChatId || !messages?.length) return;
    void writeCachedMessages(sessionId, activeChatId, messages);
  }, [activeChatId, messages, sessionId]);

  const { data: chatNotes } = useQuery<ChatNote[]>({
    queryKey: ["chat-notes", sessionId, activeChatId],
    queryFn: () =>
      api<ChatNote[]>(
        `/api/devices/${sessionId}/chats/${encodeURIComponent(activeChatId!)}/notes`,
      ),
    enabled: !!sessionId && !!activeChatId && detailsPanelOpen,
  });

		  const sendMessage = useMutation<Message, Error, SendMessageVariables, SendMessageContext>({
		    mutationFn: async ({ chatId, body, quotedMessageId }) =>
		      api<Message>(
	        `/api/devices/${sessionId}/chats/${encodeURIComponent(chatId)}/messages`,
	        {
	          method: "POST",
	          headers: { "Content-Type": "application/json" },
	          body: JSON.stringify({ body, quotedMessageId }),
	        },
	      ),
		    onMutate: async (variables) => {
		      await queryClient.cancelQueries({ queryKey: ["messages", sessionId, variables.chatId] });
		      const previousMessages = queryClient.getQueryData<Message[]>(["messages", sessionId, variables.chatId]);
		      const previousChats = queryClient.getQueryData<Chat[]>(["chats", sessionId]);
		      const timestamp = Math.floor(Date.now() / 1000);
		      const optimisticMessage: Message = {
		        id: variables.optimisticId,
		        chatId: variables.chatId,
		        from: "crm",
		        to: variables.chatId,
		        body: variables.body,
		        fromMe: true,
		        timestamp,
		        hasMedia: false,
		        type: "chat",
		        ack: 0,
		        quotedMessageId: variables.quotedMessageId ?? null,
		        quotedBody: variables.quotedPreview?.body ?? null,
		        quotedParticipant: variables.quotedPreview?.authorLabel ?? null,
		        quotedFromMe: variables.quotedPreview?.fromMe ?? null,
		      };
		      queryClient.setQueryData<Message[]>(["messages", sessionId, variables.chatId], (old = []) =>
		        appendUniqueMessages(old, optimisticMessage),
		      );
		      queryClient.setQueryData<Chat[]>(["chats", sessionId], (old = []) =>
		        old.map((chat) =>
		          chat.id === variables.chatId
		            ? {
		                ...chat,
		                timestamp,
		                lastMessage: {
		                  body: variables.body,
		                  fromMe: true,
		                  hasMedia: false,
		                  type: "chat",
		                },
		              }
		            : chat,
		        ),
		      );
		      if (variables.quotedPreview) {
		        const quotedPreview = variables.quotedPreview;
		        setMessageQuotePreviews((current) => ({
		          ...current,
		          [variables.optimisticId]: quotedPreview,
		        }));
		      }
		      setMessageInput("");
		      setReplyToMessage(null);
		      return {
		        previousMessages,
		        previousChats,
		        optimisticId: variables.optimisticId,
		        chatId: variables.chatId,
		        body: variables.body,
		      };
		    },
		    onSuccess: (newMsg, variables, context) => {
		      queryClient.setQueryData<Message[]>(["messages", sessionId, variables.chatId], (old = []) =>
		        replaceMessageById(old, context?.optimisticId ?? variables.optimisticId, newMsg),
		      );
		      queryClient.setQueryData<Chat[]>(["chats", sessionId], (old = []) =>
		        old.map((chat) =>
		          chat.id === variables.chatId
		            ? {
		                ...chat,
		                timestamp: newMsg.timestamp || chat.timestamp,
		                lastMessage: {
		                  body: newMsg.body,
		                  fromMe: true,
		                  hasMedia: newMsg.hasMedia,
		                  type: newMsg.type,
		                  mediaMimeType: newMsg.mediaMimeType,
		                  mediaFileName: newMsg.mediaFileName,
		                },
		              }
		            : chat,
		        ),
		      );
		      if (variables.quotedPreview) {
		        const optimisticId = context?.optimisticId ?? variables.optimisticId;
		        setMessageQuotePreviews((current) => ({
		          ...Object.fromEntries(Object.entries(current).filter(([id]) => id !== optimisticId)),
		          [newMsg.id]: {
		            ...variables.quotedPreview!,
		          },
		        }));
		      }
		    },
		    onError: (err, variables, context) => {
		      if (context?.previousMessages) {
		        queryClient.setQueryData(["messages", sessionId, variables.chatId], context.previousMessages);
		      } else {
		        queryClient.setQueryData<Message[]>(["messages", sessionId, variables.chatId], (old = []) =>
		          old.filter((message) => message.id !== variables.optimisticId),
		        );
		      }
		      if (context?.previousChats) {
		        queryClient.setQueryData(["chats", sessionId], context.previousChats);
		      }
		      setMessageQuotePreviews((current) =>
		        Object.fromEntries(Object.entries(current).filter(([id]) => id !== variables.optimisticId)),
		      );
		      setMessageInput((current) => current || context?.body || variables.body);
		      toast.error(err.message);
		    },
		  });

	  const messageInfoMutation = useMutation({
	    mutationFn: async (msg: Message) =>
	      api<Message>(`/api/devices/${sessionId}/messages/info`, {
	        method: "POST",
	        headers: { "Content-Type": "application/json" },
	        body: JSON.stringify({ messageId: msg.id }),
	      }),
	    onMutate: (msg) => {
	      setMessageInfo(msg);
	      setOpenMessageMenuId(null);
	    },
	    onSuccess: (payload) => {
	      setMessageInfo(payload);
	    },
	    onError: (err) => toast.error((err as Error).message),
	  });

	  const reactToMessage = useMutation<
	    { ok: boolean; reaction: string },
	    Error,
	    { msg: Message; reaction: string },
	    { previousReaction?: string }
	  >({
	    mutationFn: async ({ msg, reaction }) =>
	      api<{ ok: boolean; reaction: string }>(`/api/devices/${sessionId}/messages/react`, {
	        method: "POST",
	        headers: { "Content-Type": "application/json" },
	        body: JSON.stringify({ messageId: msg.id, reaction }),
	      }),
	    onMutate: ({ msg, reaction }) => {
	      const previousReaction = messageReactions[msg.id];
	      setMessageReactions((current) => ({ ...current, [msg.id]: reaction }));
	      setOpenMessageMenuId(null);
	      return { previousReaction };
	    },
	    onError: (err, variables, context) => {
	      setMessageReactions((current) => {
	        const next = { ...current };
	        if (context?.previousReaction) next[variables.msg.id] = context.previousReaction;
	        else delete next[variables.msg.id];
	        return next;
	      });
	      toast.error((err as Error).message);
	    },
	  });

	  const downloadMessageMediaMutation = useMutation({
	    mutationFn: async (msg: Message) => {
	      const directHref = msg.mediaUrl || (msg.body?.startsWith("data:") ? msg.body : "");
	      if (directHref) {
	        return { href: directHref, filename: fileNameFromMessage(msg) };
	      }
	      const payload = await api<DownloadedMessageMedia>(
	        `/api/devices/${sessionId}/messages/download`,
	        {
	          method: "POST",
	          headers: { "Content-Type": "application/json" },
	          body: JSON.stringify({ messageId: msg.id }),
	        },
	      );
	      return {
	        href: `data:${payload.mimetype};base64,${payload.data}`,
	        filename: payload.filename || fileNameFromMessage(msg),
	      };
	    },
	    onSuccess: ({ href, filename }) => {
	      triggerDownload(href, filename);
	      setOpenMessageMenuId(null);
	    },
	    onError: (err) => toast.error((err as Error).message),
	  });

	  const forwardMessageToChat = useMutation({
	    mutationFn: async ({ chatId, messageId }: { chatId: string; messageId: string }) =>
	      api<{ ok: boolean; message?: Message | null }>(`/api/devices/${sessionId}/messages/forward`, {
	        method: "POST",
	        headers: { "Content-Type": "application/json" },
	        body: JSON.stringify({ targetChatId: chatId, messageId }),
	      }),
	    onSuccess: (payload, variables) => {
	      setForwardMessage(null);
	      setForwardSearchQuery("");
	      if (payload.message) {
	        queryClient.setQueryData<Message[]>(
	          ["messages", sessionId, variables.chatId],
	          (old) => appendUniqueMessages(old, payload.message!),
	        );
	        queryClient.setQueryData<Chat[]>(["chats", sessionId], (old) =>
	          old?.map((chat) =>
	            chat.id === variables.chatId
	              ? {
	                  ...chat,
	                  timestamp: payload.message?.timestamp || chat.timestamp,
	                  lastMessage: {
	                    body: payload.message?.body || "",
	                    fromMe: true,
	                    hasMedia: payload.message?.hasMedia,
	                    type: payload.message?.type,
	                    mediaMimeType: payload.message?.mediaMimeType,
	                    mediaFileName: payload.message?.mediaFileName,
	                  },
	                }
	              : chat,
	          ),
	        );
	        toast.success("Mensaje reenviado");
	      } else {
	        toast.error("WhatsApp confirmó el reenvío, pero no devolvió el material para previsualizar.");
	      }
	      void queryClient.invalidateQueries({ queryKey: ["chats", sessionId] });
	    },
	    onError: (err) => toast.error((err as Error).message),
	  });

	  const pinMessageMutation = useMutation({
	    mutationFn: async ({ msg, pinned }: { msg: Message; pinned: boolean }) =>
	      api<{ ok: boolean; pinned: boolean }>(`/api/devices/${sessionId}/messages/pin`, {
	        method: "POST",
	        headers: { "Content-Type": "application/json" },
	        body: JSON.stringify({ messageId: msg.id, pinned, durationSeconds: 604800 }),
	      }),
	    onSuccess: (payload, variables) => {
	      setMessagePinOverrides((current) => ({ ...current, [variables.msg.id]: payload.pinned }));
	      setPinnedMessageIds((current) =>
	        payload.pinned
	          ? current.includes(variables.msg.id)
	            ? current
	            : [...current, variables.msg.id]
	          : current.filter((id) => id !== variables.msg.id),
	      );
	      setOpenMessageMenuId(null);
	      toast.success(payload.pinned ? "Mensaje fijado" : "Mensaje desfijado");
	    },
	    onError: (err) => toast.error((err as Error).message),
	  });

	  const starMessageMutation = useMutation({
	    mutationFn: async ({ msg, starred }: { msg: Message; starred: boolean }) =>
	      api<{ ok: boolean; starred: boolean }>(`/api/devices/${sessionId}/messages/star`, {
	        method: "POST",
	        headers: { "Content-Type": "application/json" },
	        body: JSON.stringify({ messageId: msg.id, starred }),
	      }),
	    onSuccess: (payload, variables) => {
	      setMessageStarOverrides((current) => ({ ...current, [variables.msg.id]: payload.starred }));
	      setStarredMessageIds((current) =>
	        payload.starred
	          ? current.includes(variables.msg.id)
	            ? current
	            : [...current, variables.msg.id]
	          : current.filter((id) => id !== variables.msg.id),
	      );
	      setOpenMessageMenuId(null);
	      toast.success(payload.starred ? "Mensaje destacado" : "Destacado quitado");
	    },
	    onError: (err) => toast.error((err as Error).message),
	  });

	  const deleteMessageMutation = useMutation({
	    mutationFn: async (msg: Message) =>
	      api<{ ok: boolean }>(`/api/devices/${sessionId}/messages/delete`, {
	        method: "POST",
	        headers: { "Content-Type": "application/json" },
	        body: JSON.stringify({ messageId: msg.id }),
	      }),
	    onSuccess: (_, msg) => {
	      setHiddenMessageIds((current) => (current.includes(msg.id) ? current : [...current, msg.id]));
	      setOpenMessageMenuId(null);
	      toast.success("Mensaje eliminado");
	      void queryClient.invalidateQueries({ queryKey: ["messages", sessionId, activeChatId] });
	      void queryClient.invalidateQueries({ queryKey: ["chats", sessionId] });
	    },
	    onError: (err) => toast.error((err as Error).message),
	  });

  const sendMediaFiles = useMutation({
    mutationFn: async ({ files, caption, asVoice }: { files: File[]; caption: string; asVoice?: boolean }) => {
      if (!currentPermissions.canSendMedia) {
        throw new Error("No tienes permiso para enviar archivos");
      }
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      if (caption.trim()) formData.append("caption", caption.trim());
      if (asVoice) formData.append("asVoice", "true");
      return api<{ ok: boolean; sent: Message[] }>(
        `/api/devices/${sessionId}/chats/${encodeURIComponent(activeChatId!)}/media`,
        {
          method: "POST",
          body: formData,
        },
      );
    },
    onSuccess: (payload) => {
      queryClient.setQueryData<Message[]>(["messages", sessionId, activeChatId], (old = []) =>
        appendUniqueMessages(old, payload.sent),
      );
	      setPendingFiles([]);
	      setMessageInput("");
	      setReplyToMessage(null);
	      void queryClient.invalidateQueries({ queryKey: ["chats", sessionId] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

	  const sendQuickReply = useMutation({
	    mutationFn: async (replyId: number) => {
	      if (!currentPermissions.canUseQuickReplies) {
	        throw new Error("No tienes permiso para usar respuestas rápidas");
      }
      return api(
        `/api/devices/${sessionId}/chats/${encodeURIComponent(activeChatId!)}/quick-reply/${replyId}`,
        { method: "POST" },
      );
	    },
	    onSuccess: () => {
	      setQuickReplyOpen(false);
	      quickReplySlashOpenRef.current = false;
	      if (clearMessageInputAfterQuickReplyRef.current) {
	        setMessageInput("");
	      }
	      clearMessageInputAfterQuickReplyRef.current = false;
	      setQuickReplyHighlightIndex(0);
	      void queryClient.invalidateQueries({ queryKey: ["messages", sessionId, activeChatId] });
	      void queryClient.invalidateQueries({ queryKey: ["chats", sessionId] });
	    },
	    onError: (err) => {
	      clearMessageInputAfterQuickReplyRef.current = false;
	      toast.error((err as Error).message);
	    },
	  });

	  const selectQuickReply = (reply: QuickReply) => {
	    if (!activeChatId) {
	      toast.info("Selecciona un chat para enviar esta respuesta.");
	      return;
	    }
	    if (!currentPermissions.canUseQuickReplies) {
	      toast.error("No tienes permiso para usar respuestas rápidas");
	      return;
	    }
	    setQuickReplyOpen(false);
	    quickReplySlashOpenRef.current = false;
	    setQuickReplyHighlightIndex(0);
	    clearMessageInputAfterQuickReplyRef.current = quickReplyCommandActive;
	    sendQuickReply.mutate(reply.id);
	    requestAnimationFrame(() => messageTextareaRef.current?.focus());
	  };

	  const createQuickReply = useMutation({
    mutationFn: async () => {
      if (!currentPermissions.canManageQuickReplies) {
        throw new Error("No tienes permiso para administrar respuestas rápidas");
      }
      return api<QuickReply>("/api/quick-replies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shortcut: quickReplyShortcut.trim(),
          title: quickReplyTitle.trim(),
          body: quickReplyBody,
        }),
      });
    },
    onSuccess: () => {
      setQuickReplyShortcut("");
      setQuickReplyTitle("");
      setQuickReplyBody("");
      setQuickReplyDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["quick-replies"] });
      toast.success("Respuesta rápida creada");
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const createCollaborator = useMutation({
    mutationFn: async () =>
      api<Collaborator>("/api/collaborators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: collaboratorName,
          username: collaboratorEmail,
          password: collaboratorPassword,
          labelColor: collaboratorColor,
        }),
      }),
    onSuccess: () => {
      setCollaboratorName("");
      setCollaboratorEmail("");
      setCollaboratorPassword("");
      setCollaboratorColor(COLLABORATOR_COLOR_OPTIONS[0]);
      void queryClient.invalidateQueries({ queryKey: ["collaborators"] });
      toast.success("Colaborador creado");
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const updateCollaboratorPermissions = useMutation({
    mutationFn: async (args: { id: number; permissions: CollaboratorPermissions }) =>
      api<Collaborator>(`/api/collaborators/${args.id}/permissions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions: args.permissions }),
      }),
    onSuccess: () => {
      setPermissionTargetId(null);
      void queryClient.invalidateQueries({ queryKey: ["collaborators"] });
      toast.success("Permisos actualizados");
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const loadAgentModels = useMutation({
    mutationFn: async () =>
      api<AgentModelsResponse>("/api/agent-settings/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openAiApiKey: agentOpenAiApiKey.trim() || undefined }),
      }),
    onSuccess: (payload) => {
      queryClient.setQueryData(["agent-models"], payload);
      if (payload.models.length > 0 && !payload.models.includes(agentModel)) {
        setAgentModel(payload.models[0] ?? DEFAULT_AGENT_MODEL);
      }
      toast.success(payload.configured ? "Modelos actualizados desde OpenAI" : "Modelos base cargados");
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const saveAgentSettings = useMutation({
    mutationFn: async () => {
      const trainingConfig = buildAgentTrainingConfig();
      const formData = new FormData();
      formData.append("settings", JSON.stringify({
        enabled: agentEnabled,
        openAiApiKey: agentOpenAiApiKey.trim() || undefined,
        model: agentModel.trim() || DEFAULT_AGENT_MODEL,
        trainingConfig,
      }));
      agentTrainingAssets.images.forEach((asset, index) => {
        formData.append(`images:${index}`, asset.file, asset.file.name);
      });
      agentTrainingAssets.video.forEach((asset, index) => {
        formData.append(`video:${index}`, asset.file, asset.file.name);
      });
      agentTrainingAssets.pdf.forEach((asset, index) => {
        formData.append(`pdf:${index}`, asset.file, asset.file.name);
      });
      return api<AgentSettingsResponse>("/api/agent-settings", {
        method: "PATCH",
        body: formData,
      });
    },
    onSuccess: (settings) => {
      setAgentOpenAiApiKey("");
      setAgentModel(settings.model || DEFAULT_AGENT_MODEL);
      agentSettingsAppliedRef.current = true;
      queryClient.setQueryData(["agent-settings"], settings);
      void queryClient.invalidateQueries({ queryKey: ["agent-models"] });
      toast.success(settings.enabled ? "Agente IA conectado" : "Configuración del agente guardada");
    },
    onError: (err) => toast.error((err as Error).message),
  });

	  const mutateChatState = useMutation({
	    mutationFn: async (args: {
	      chat: Chat;
	      patch: Partial<{
        archived: boolean;
        favorited: boolean;
        pinned: boolean;
        muted: boolean;
        emailNotifications: boolean;
        manuallyUnread: boolean;
        clearUnread: boolean;
        customName: string | null;
      }>;
    }) => {
      if (!currentPermissions.canManageChats) {
        throw new Error("No tienes permiso para organizar chats");
      }
      return api(`/api/devices/${sessionId}/chats/${encodeURIComponent(args.chat.id)}/state`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: args.chat.name,
          isGroup: args.chat.isGroup,
          ...args.patch,
	        }),
	      });
	    },
	    onMutate: async (args) => {
	      await queryClient.cancelQueries({ queryKey: ["chats", sessionId] });
	      const previousChats = queryClient.getQueryData<Chat[]>(["chats", sessionId]);
	      queryClient.setQueryData<Chat[]>(["chats", sessionId], (old = []) =>
	        old.map((chat) => (chat.id === args.chat.id ? { ...chat, ...args.patch } : chat)),
	      );
	      return { previousChats };
	    },
	    onSuccess: (_, args) => {
	      if ("customName" in args.patch) {
	        toast.success(args.patch.customName ? "Nombre guardado" : "Nombre eliminado");
	      }
	      if ("pinned" in args.patch) {
	        toast.success(args.patch.pinned ? "Chat fijado arriba" : "Chat desfijado");
	      }
	      void queryClient.invalidateQueries({ queryKey: ["chats", sessionId] });
	    },
	    onError: (err, _args, context) => {
	      if (context?.previousChats) {
	        queryClient.setQueryData(["chats", sessionId], context.previousChats);
	      }
	      toast.error((err as Error).message);
	    },
	  });

  const editChatCustomName = (chat: Chat) => {
    const currentName = savedChatName(chat);
    const nextName = window.prompt("Nombre visible para este usuario", currentName || "");
    if (nextName === null) return;
    const customName = nextName.trim();
    if (!customName) {
      toast.info("Escribe un nombre para guardarlo o usa eliminar nombre.");
      return;
    }
    mutateChatState.mutate({ chat, patch: { customName } });
  };

  const removeChatCustomName = (chat: Chat) => {
    mutateChatState.mutate({ chat, patch: { customName: null } });
  };

	  const assignChat = useMutation<
	    { assignedTo: ChatAssignment | null },
	    Error,
	    { chat: Chat; collaborator: Collaborator | null },
	    { previousChats?: Chat[] }
	  >({
	    mutationFn: async (args) => {
	      if (!currentPermissions.canManageChats) {
	        throw new Error("No tienes permiso para derivar chats");
	      }
	      return api<{ assignedTo: ChatAssignment | null }>(
	        `/api/devices/${sessionId}/chats/${encodeURIComponent(args.chat.id)}/assignment`,
	        {
	          method: "PATCH",
	          headers: { "Content-Type": "application/json" },
	          body: JSON.stringify({
	            name: args.chat.name,
	            isGroup: args.chat.isGroup,
	            assignedUserId: args.collaborator?.id ?? null,
	          }),
	        },
	      );
	    },
	    onMutate: async (args) => {
	      setAssignmentTargetChat(null);
	      setChatMenuOpen(false);
	      await queryClient.cancelQueries({ queryKey: ["chats", sessionId] });
	      const previousChats = queryClient.getQueryData<Chat[]>(["chats", sessionId]);
	      queryClient.setQueryData<Chat[]>(["chats", sessionId], (old = []) =>
	        old.map((chat) =>
	          chat.id === args.chat.id
	            ? {
	                ...chat,
	                assignedTo: args.collaborator
	                  ? {
	                      userId: args.collaborator.id,
	                      username: args.collaborator.username,
	                      displayName: args.collaborator.displayName,
	                      color: args.collaborator.labelColor || COLLABORATOR_COLOR_OPTIONS[0],
	                      assignedByUserId: user?.id ?? null,
	                      assignedAt: new Date().toISOString(),
	                    }
	                  : null,
	              }
	            : chat,
	        ),
	      );
	      return { previousChats };
	    },
	    onSuccess: (payload, args) => {
	      queryClient.setQueryData<Chat[]>(["chats", sessionId], (old = []) =>
	        old.map((chat) => (chat.id === args.chat.id ? { ...chat, assignedTo: payload.assignedTo } : chat)),
	      );
	      toast.success(args.collaborator ? `Chat derivado a ${args.collaborator.displayName}` : "Derivación quitada");
	      void queryClient.invalidateQueries({ queryKey: ["chats", sessionId] });
	    },
	    onError: (err, _args, context) => {
	      if (context?.previousChats) {
	        queryClient.setQueryData(["chats", sessionId], context.previousChats);
	      }
	      toast.error((err as Error).message);
	    },
	  });

	  const createChatNote = useMutation({
    mutationFn: async () => {
      if (!sessionId || !activeChat) throw new Error("Selecciona un chat primero.");
      const cleanBody = noteBody.trim();
      if (!cleanBody && noteFiles.length === 0) {
        throw new Error("Agrega una nota o adjunta un archivo.");
      }
      const postNote = (file: File | null, body: string) => {
        const formData = new FormData();
        if (body) formData.append("body", body);
        if (file) formData.append("file", file);
        formData.append("name", activeChat.name);
        formData.append("isGroup", String(activeChat.isGroup));
        return api<ChatNote>(
          `/api/devices/${sessionId}/chats/${encodeURIComponent(activeChat.id)}/notes`,
          {
            method: "POST",
            body: formData,
          },
        );
      };

      if (noteFiles.length === 0) return [await postNote(null, cleanBody)];
      const created: ChatNote[] = [];
      for (let index = 0; index < noteFiles.length; index += 1) {
        created.push(await postNote(noteFiles[index], index === 0 ? cleanBody : ""));
      }
      return created;
    },
    onSuccess: (notes) => {
      setNoteBody("");
      setNoteFiles([]);
      setIsDraggingNoteFiles(false);
      if (noteFileInputRef.current) noteFileInputRef.current.value = "";
      queryClient.setQueryData<ChatNote[]>(["chat-notes", sessionId, activeChatId], (old = []) => [
        ...notes,
        ...old.filter((item) => !notes.some((note) => note.id === item.id)),
      ]);
      toast.success(notes.length === 1 ? "Nota añadida" : "Notas añadidas");
    },
	    onError: (err) => toast.error((err as Error).message),
	  });

	  const sendTeamMessage = useMutation<InternalTeamMessage[], Error, SendTeamMessageVariables, SendTeamMessageContext>({
	    mutationFn: async ({ recipientUser, body, files }) => {
	      const cleanBody = body.trim();
	      if (!cleanBody && files.length === 0) {
	        throw new Error("Escribe un mensaje o adjunta un archivo.");
	      }
	      const postInternalMessage = (file: File | null, messageBody: string) => {
	        const formData = new FormData();
	        formData.append("recipientUserId", String(recipientUser.id));
	        if (messageBody) formData.append("body", messageBody);
	        if (file) formData.append("file", file);
	        return api<InternalTeamMessage>("/api/team/messages", {
	          method: "POST",
	          body: formData,
	        });
	      };

	      if (files.length === 0) return [await postInternalMessage(null, cleanBody)];
	      const created: InternalTeamMessage[] = [];
	      for (let index = 0; index < files.length; index += 1) {
	        created.push(await postInternalMessage(files[index], index === 0 ? cleanBody : ""));
	      }
	      return created;
	    },
	    onMutate: async ({ recipientUser, body, files }) => {
	      if (!user) throw new Error("Sesión no disponible.");
	      const cleanBody = body.trim();
	      await queryClient.cancelQueries({ queryKey: ["team-messages", recipientUser.id] });
	      const previousMessages = queryClient.getQueryData<InternalTeamMessage[]>([
	        "team-messages",
	        recipientUser.id,
	      ]);
	      const now = new Date().toISOString();
	      const objectUrls: string[] = [];
	      const optimisticMessages: InternalTeamMessage[] =
	        files.length > 0
	          ? files.map((file, index) => {
	              const fileUrl = URL.createObjectURL(file);
	              objectUrls.push(fileUrl);
	              return {
	                id: -(Date.now() + index),
	                senderUserId: user.id,
	                recipientUserId: recipientUser.id,
	                body: index === 0 ? cleanBody : "",
	                fileName: file.name,
	                fileUrl,
	                fileMimeType: file.type || "application/octet-stream",
	                fileSizeBytes: file.size,
	                readAt: null,
	                createdAt: now,
	                senderDisplayName: user.displayName,
	                senderUsername: user.username,
	              };
	            })
	          : [
	              {
	                id: -Date.now(),
	                senderUserId: user.id,
	                recipientUserId: recipientUser.id,
	                body: cleanBody,
	                fileName: null,
	                fileUrl: null,
	                fileMimeType: null,
	                fileSizeBytes: null,
	                readAt: null,
	                createdAt: now,
	                senderDisplayName: user.displayName,
	                senderUsername: user.username,
	              },
	            ];

	      queryClient.setQueryData<InternalTeamMessage[]>(["team-messages", recipientUser.id], (old = []) =>
	        appendUniqueTeamMessages(old, optimisticMessages),
	      );
	      setTeamMessageInput("");
	      setTeamMessageFiles([]);
	      setIsDraggingTeamFiles(false);
	      if (teamFileInputRef.current) teamFileInputRef.current.value = "";
	      window.setTimeout(() => teamMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 0);
	      return {
	        peerUserId: recipientUser.id,
	        previousMessages,
	        optimisticIds: optimisticMessages.map((message) => message.id),
	        objectUrls,
	        previousInput: body,
	        previousFiles: files,
	      };
	    },
	    onSuccess: (created, _variables, context) => {
	      const peerUserId = context?.peerUserId ?? activeTeamUserId;
	      if (peerUserId) {
	        queryClient.setQueryData<InternalTeamMessage[]>(["team-messages", peerUserId], (old = []) =>
	          appendUniqueTeamMessages(
	            old.filter((item) => !context?.optimisticIds.includes(item.id)),
	            created,
	          ),
	        );
	      }
	      context?.objectUrls.forEach((url) => URL.revokeObjectURL(url));
	      void queryClient.invalidateQueries({ queryKey: ["collaborators"] });
	      window.setTimeout(() => teamMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 0);
	    },
	    onError: (err, _variables, context) => {
	      if (context) {
	        queryClient.setQueryData<InternalTeamMessage[]>(["team-messages", context.peerUserId], context.previousMessages);
	        context.objectUrls.forEach((url) => URL.revokeObjectURL(url));
	        setTeamMessageInput(context.previousInput);
	        setTeamMessageFiles(context.previousFiles);
	      }
	      toast.error((err as Error).message);
	    },
	  });

		  const addMessageToNote = useMutation({
	    mutationFn: async (msg: Message) => {
	      if (!sessionId || !activeChat) throw new Error("Selecciona un chat primero.");
	      const formData = new FormData();
	      formData.append("body", messageNoteText(msg));
	      formData.append("name", activeChat.name);
	      formData.append("isGroup", String(activeChat.isGroup));
	      return api<ChatNote>(
	        `/api/devices/${sessionId}/chats/${encodeURIComponent(activeChat.id)}/notes`,
	        {
	          method: "POST",
	          body: formData,
	        },
	      );
	    },
	    onSuccess: (note) => {
	      queryClient.setQueryData<ChatNote[]>(["chat-notes", sessionId, activeChatId], (old = []) => [
	        note,
	        ...old.filter((item) => item.id !== note.id),
	      ]);
	      setDetailsPanelOpen(true);
	      setPendingPanelOpen(false);
	      toast.success("Texto añadido a notas");
	    },
	    onError: (err) => toast.error((err as Error).message),
	  });

	  const toggleLabelOnChat = useMutation<
    unknown,
    Error,
    { chat: Chat; labelId: number; attached: boolean },
    { previousChats?: Chat[] }
  >({
    mutationFn: async (args: { chat: Chat; labelId: number; attached: boolean }) => {
      if (!currentPermissions.canManageLabels) {
        throw new Error("No tienes permiso para administrar etiquetas");
      }
      const path = `/api/devices/${sessionId}/chats/${encodeURIComponent(args.chat.id)}/labels/${args.labelId}`;
      if (args.attached) return api(path, { method: "DELETE" });
      return api(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: args.chat.name, isGroup: args.chat.isGroup }),
      });
    },
    onMutate: async (args) => {
      setHeaderLabelsOpen(false);
      await queryClient.cancelQueries({ queryKey: ["chats", sessionId] });
      const previousChats = queryClient.getQueryData<Chat[]>(["chats", sessionId]);
      const targetLabel = labels?.find((label) => label.id === args.labelId);
      if (targetLabel) {
        queryClient.setQueryData<Chat[]>(["chats", sessionId], (old = []) =>
          old.map((chat) => {
            if (chat.id !== args.chat.id) return chat;
            const nextLabels = args.attached
              ? chat.labels.filter((label) => label.id !== args.labelId)
              : chat.labels.some((label) => label.id === args.labelId)
                ? chat.labels
                : [...chat.labels, targetLabel];
            return { ...chat, labels: nextLabels };
          }),
        );
      }
      return { previousChats };
    },
    onSuccess: (_result, args) => {
      toast.success(args.attached ? "Etiqueta quitada" : "Etiqueta aplicada");
      void queryClient.invalidateQueries({ queryKey: ["chats", sessionId] });
    },
    onError: (err, _args, context) => {
      if (context?.previousChats) {
        queryClient.setQueryData(["chats", sessionId], context.previousChats);
      }
      toast.error((err as Error).message);
    },
  });

  useEffect(() => {
    if (!isAdmin && leftPanel === "settings") {
      setLeftPanel("chats");
    }
  }, [isAdmin, leftPanel]);

	  useEffect(() => {
	    if (!agentSettings || agentSettingsAppliedRef.current) return;
	    const config = agentSettings.trainingConfig ?? {};
    agentSettingsAppliedRef.current = true;
    setAgentEnabled(agentSettings.enabled);
    setAgentModel(agentSettings.model || DEFAULT_AGENT_MODEL);
    setAgentTrainingEnabled({
      text: config.trainingEnabled?.text ?? true,
      images: config.trainingEnabled?.images ?? false,
      video: config.trainingEnabled?.video ?? false,
      pdf: config.trainingEnabled?.pdf ?? false,
    });
    setAgentVoiceReplies(config.voiceReplies ?? true);
    setAgentAudioToText(config.audioToText ?? true);
    setAgentResponseScope(
      config.responseScope === "notTagged" ||
        config.responseScope === "all" ||
        config.responseScope === "exceptTagged"
        ? config.responseScope
        : "tagged",
    );
    setAgentSelectedLabelIds(
      Array.isArray(config.selectedLabelIds)
        ? config.selectedLabelIds.map((id) => Number(id)).filter(Number.isFinite)
        : [],
    );
	    setAgentTextRules(restoreTextRules(config.textRules));
	  }, [agentSettings]);

	  useEffect(() => {
	    setQuickReplyHighlightIndex(0);
	  }, [quickReplyCommandQuery, visibleQuickReplies.length]);

	  useEffect(() => {
	    if (quickReplyCommandActive && currentPermissions.canUseQuickReplies) {
	      quickReplySlashOpenRef.current = true;
	      setQuickReplyOpen(true);
	      setAttachmentMenuOpen(false);
	      setEmojiOpen(false);
	      return;
	    }
	    if (quickReplySlashOpenRef.current && !quickReplyCommandActive) {
	      quickReplySlashOpenRef.current = false;
	      setQuickReplyOpen(false);
	    }
	  }, [quickReplyCommandActive, currentPermissions.canUseQuickReplies]);

	  useEffect(() => {
	    if (!sessionId) return;
	    if (activeChatId) {
      void fetch(`/api/devices/${sessionId}/chats/${encodeURIComponent(activeChatId)}/clear-unread`, {
        method: "POST",
        credentials: "include",
      }).then(() => queryClient.invalidateQueries({ queryKey: ["chats", sessionId] }));
    } else {
      void fetch(`/api/devices/${sessionId}/active-chat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waChatId: null }),
      });
	    }
	  }, [activeChatId, sessionId, queryClient]);

	  useEffect(() => () => {
	    sendAudioAfterStopRef.current = false;
	    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
	      mediaRecorderRef.current.stop();
	    }
	    if (audioRecordingTimerRef.current) clearInterval(audioRecordingTimerRef.current);
	    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
	  }, []);

	  useEffect(() => {
    const unlock = () => unlockNotificationSound();
    window.addEventListener("pointerdown", unlock, { once: true, passive: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
	    setPendingFiles([]);
	    sendAudioAfterStopRef.current = false;
	    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
	      mediaRecorderRef.current.stop();
	    } else {
	      if (audioRecordingTimerRef.current) {
	        clearInterval(audioRecordingTimerRef.current);
	        audioRecordingTimerRef.current = null;
	      }
	      audioStreamRef.current?.getTracks().forEach((track) => track.stop());
	      audioStreamRef.current = null;
	      mediaRecorderRef.current = null;
	      audioChunksRef.current = [];
	      setIsRecordingAudio(false);
	      setAudioRecordingSeconds(0);
	    }
	    setIsDraggingFiles(false);
    setMediaPanelOpen(false);
	    setOpenMessageMenuId(null);
	    setReplyToMessage(null);
	    setForwardMessage(null);
	    setQuickReplyOpen(false);
	    quickReplySlashOpenRef.current = false;
	    clearMessageInputAfterQuickReplyRef.current = false;
		    setQuickReplyHighlightIndex(0);
		    setMessageInfo(null);
	    setChatSearchOpen(false);
	    setChatSearchQuery("");
	    setActiveSearchMatchIndex(0);
	    setNoteBody("");
    setNoteFiles([]);
    setIsDraggingNoteFiles(false);
    setNotePreview(null);
    if (noteFileInputRef.current) noteFileInputRef.current.value = "";
  }, [activeChatId]);

  useEffect(() => {
    if (!socket || !sessionId) return;
    socket.emit("subscribe-device", sessionId);

    const handleMessage = (data: { sessionId?: string } & Message) => {
      if (data.sessionId && data.sessionId !== sessionId) return;
      if (data.id && seenSocketMessageIdsRef.current.has(data.id)) return;
      if (data.id) {
        seenSocketMessageIdsRef.current.add(data.id);
        if (seenSocketMessageIdsRef.current.size > 500) {
          seenSocketMessageIdsRef.current = new Set(
            Array.from(seenSocketMessageIdsRef.current).slice(-250),
          );
        }
      }
      const cachedChats = queryClient.getQueryData<Chat[]>(["chats", sessionId]);
      const incomingChat = cachedChats?.find((chat) => chat.id === data.chatId);
      const muted = isChatMuted(cachedChats, data.chatId);
      if (!data.fromMe && !muted) {
        playIncomingMessageSound();
        if (data.chatId !== activeChatId) {
          toast.message(displayChatCode(incomingChat) || "WhatsApp", {
            description: sanitizePreview(data.body || (data.hasMedia ? "Archivo recibido" : "")),
            className: "crm-message-toast",
            classNames: {
              closeButton: "crm-message-toast-close",
              title: "crm-message-toast-title",
              description: "crm-message-toast-description",
              content: "crm-message-toast-content",
            },
            closeButton: true,
            duration: 4500,
            position: "top-right",
          });
        }
      }

	      let matchedExistingChat = false;
      let nextChatsSnapshot: Chat[] | undefined;
	      queryClient.setQueryData<Chat[]>(["chats", sessionId], (old) => {
	        if (!old) return old;
	        const incomingUnread = !data.fromMe && data.chatId !== activeChatId ? 1 : 0;
	        const next = old.map((chat) => {
	          if (chat.id !== data.chatId) return chat;
	          matchedExistingChat = true;
	          return {
	            ...chat,
            unreadCount: Math.max(chat.unreadCount || 0, 0) + incomingUnread,
            timestamp: data.timestamp || chat.timestamp,
            lastMessage: {
              body: data.body || "",
              fromMe: data.fromMe,
              hasMedia: data.hasMedia,
              type: data.type,
              mediaMimeType: data.mediaMimeType,
              mediaFileName: data.mediaFileName,
	            },
	          };
	        });
        nextChatsSnapshot = matchedExistingChat ? next : old;
	        return nextChatsSnapshot;
	      });
      if (nextChatsSnapshot?.length) {
        void writeCachedChats(sessionId, nextChatsSnapshot);
      }

      let nextMessagesSnapshot: Message[] | undefined;
      queryClient.setQueryData<Message[]>(["messages", sessionId, data.chatId], (old) => {
        if (data.chatId === activeChatId) {
          nextMessagesSnapshot = appendUniqueMessages(old ?? [], data);
          return nextMessagesSnapshot;
        }
        if (old) {
          nextMessagesSnapshot = appendUniqueMessages(old, data);
          return nextMessagesSnapshot;
        }
        return old;
      });
      if (nextMessagesSnapshot?.length) {
        void writeCachedMessages(sessionId, data.chatId, nextMessagesSnapshot);
      }
	      if (!matchedExistingChat) {
	        void queryClient.invalidateQueries({ queryKey: ["chats", sessionId] });
	      }
    };
    const handleMessagesHydrated = (data: { sessionId?: string; chatId?: string; messages?: Message[] }) => {
      if (data.sessionId && data.sessionId !== sessionId) return;
      if (!data.chatId || !Array.isArray(data.messages)) return;
      const sortedMessages = data.messages
        .slice()
        .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
      queryClient.setQueryData<Message[]>(["messages", sessionId, data.chatId], (old = []) => {
        const next = appendUniqueMessages(old, sortedMessages)
          .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
          .slice(-100);
        void writeCachedMessages(sessionId, data.chatId!, next);
        return next;
      });
    };
    const handleChatsUpdated = (data: { sessionId?: string }) => {
      if (data.sessionId && data.sessionId !== sessionId) return;
      void queryClient.invalidateQueries({ queryKey: ["chats", sessionId] });
    };
    socket.on("message", handleMessage);
    socket.on("messages-hydrated", handleMessagesHydrated);
    socket.on("chats-updated", handleChatsUpdated);
    return () => {
      socket.off("message", handleMessage);
      socket.off("messages-hydrated", handleMessagesHydrated);
      socket.off("chats-updated", handleChatsUpdated);
    };
  }, [socket, sessionId, activeChatId, queryClient]);

  useEffect(() => {
    if (!socket || !user?.id) return;
    const handleInternalMessage = (payload: { message?: InternalTeamMessage }) => {
      const message = payload.message;
      if (!message?.id) return;
      const peerUserId =
        message.senderUserId === user.id ? message.recipientUserId : message.senderUserId;

      queryClient.setQueryData<InternalTeamMessage[]>(["team-messages", peerUserId], (old = []) =>
        appendUniqueTeamMessages(old, message),
      );

      if (message.senderUserId !== user.id) {
        queryClient.setQueryData<Collaborator[]>(["collaborators"], (old) =>
          old?.map((collaborator) =>
            collaborator.id === peerUserId
              ? {
                  ...collaborator,
                  unreadInternalCount:
                    activeTeamUserId === peerUserId
                      ? collaborator.unreadInternalCount || 0
                      : (collaborator.unreadInternalCount || 0) + 1,
                }
              : collaborator,
          ),
        );
        if (activeTeamUserId !== peerUserId) {
          toast.message(message.senderDisplayName || "Mensaje interno", {
            description: message.body || message.fileName || "Archivo interno",
            closeButton: true,
            duration: 3500,
            position: "top-right",
          });
        }
      }
    };
    socket.on("internal-message", handleInternalMessage);
    return () => {
      socket.off("internal-message", handleInternalMessage);
    };
  }, [activeTeamUserId, queryClient, socket, user?.id]);

		  useEffect(() => {
		    if (messagesEndRef.current) {
		      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
		    }
		  }, [messages]);

		  useEffect(() => {
		    if (leftPanel === "team") {
		      teamMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
		    }
		  }, [displayedTeamMessages, leftPanel, activeTeamUserId]);

		  useEffect(() => {
		    if (!chatSearchOpen) return;
		    window.setTimeout(() => chatSearchInputRef.current?.focus(), 0);
		  }, [chatSearchOpen]);

  useEffect(() => {
    if (!imagePreview) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setImagePreview(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [imagePreview]);

  useEffect(() => {
    if (!notePreview) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNotePreview(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [notePreview]);

  useEffect(() => {
    if (!forwardMessage && !messageInfo && !openMessageMenuId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setForwardMessage(null);
      setMessageInfo(null);
      setOpenMessageMenuId(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [forwardMessage, messageInfo, openMessageMenuId]);

  useEffect(() => {
    if (!agentPanelOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (agentTextRuleEditor) {
        setAgentTextRuleEditor(null);
        return;
      }
      setAgentPanelOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [agentPanelOpen, agentTextRuleEditor]);

  const addNoteFiles = (files: FileList | File[]) => {
    const incoming = Array.from(files).filter((file) => file.size > 0);
    if (incoming.length === 0) return;
    setNoteFiles((current) => {
      const seen = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      const unique = incoming.filter((file) => {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return [...current, ...unique].slice(0, 10);
    });
  };

  const addTeamFiles = (files: FileList | File[]) => {
    const incoming = Array.from(files).filter(isAllowedUpload);
    if (incoming.length === 0) {
      toast.error("Formato no compatible.");
      return;
    }
    setTeamMessageFiles((current) => {
      const seen = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      const unique = incoming.filter((file) => {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return [...current, ...unique].slice(0, 10);
    });
  };

		  const addPendingFiles = (files: FileList | File[]) => {
	    if (!activeChatId) {
	      toast.info("Selecciona un chat primero.");
	      return;
	    }
	    if (!currentPermissions.canSendMedia) {
	      toast.error("No tienes permiso para enviar archivos");
	      return;
    }
    const incoming = Array.from(files).filter(isAllowedUpload);
    if (incoming.length === 0) {
      toast.error("Formato no compatible.");
      return;
    }
    setPendingFiles((current) => {
      const seen = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      const unique = incoming.filter((file) => {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return [...current, ...unique].slice(0, 10);
	    });
	    closeMenus(setAttachmentMenuOpen, setEmojiOpen, setQuickReplyOpen);
	  };

			  const copyMessageText = (msg: Message) => {
			    const text = messageActionText(msg);
			    void navigator.clipboard?.writeText(text)
			      .then(() => toast.success("Mensaje copiado"))
			      .catch(() => toast.error("No se pudo copiar el mensaje"));
			    setOpenMessageMenuId(null);
			  };

  const copyChatCode = (chat: Chat) => {
    const formattedCode = copyableChatCode(chat);
    if (!formattedCode) {
      toast.info("Este chat no tiene codigo verificado.");
      return;
    }
    void writeClipboardText(formattedCode)
      .then(() => {
        setCopiedChatCodeId(chat.id);
        toast.success(`Codigo ${formattedCode} copiado`);
        window.setTimeout(() => {
          setCopiedChatCodeId((current) => (current === chat.id ? null : current));
        }, 1400);
      })
      .catch(() => toast.error("No se pudo copiar el codigo"));
  };

		  const openChatSearch = () => {
		    if (!activeChatId) {
		      toast.info("Selecciona un chat para buscar.");
		      return;
		    }
		    setChatSearchOpen(true);
		    closeMenus(setChatMenuOpen, setHeaderLabelsOpen, setAttachmentMenuOpen, setEmojiOpen, setQuickReplyOpen);
		    window.setTimeout(() => chatSearchInputRef.current?.focus(), 0);
		  };

		  const closeChatSearch = () => {
		    setChatSearchOpen(false);
		    setChatSearchQuery("");
		    setActiveSearchMatchIndex(0);
		  };

		  const moveChatSearch = (direction: 1 | -1) => {
		    const total = chatSearchMatches.length;
		    if (!total) return;
		    setActiveSearchMatchIndex((current) => (current + direction + total) % total);
		  };

			  const downloadMessageMedia = (msg: Message) => {
		    if (!msg.hasMedia && !msg.mediaUrl && !msg.body?.startsWith("data:")) {
		      toast.info("Este mensaje no tiene archivo descargable.");
		      setOpenMessageMenuId(null);
		      return;
		    }
		    downloadMessageMediaMutation.mutate(msg);
		  };

	  const addReactionToMessage = (msg: Message, reaction: string) => {
	    if (!currentPermissions.canReply) {
	      toast.error("No tienes permiso para reaccionar mensajes");
	      return;
	    }
	    reactToMessage.mutate({ msg, reaction });
	  };

	  const deleteMessageLocally = (msg: Message) => {
	    if (!currentPermissions.canManageChats) {
	      toast.error("No tienes permiso para eliminar mensajes");
	      return;
	    }
	    deleteMessageMutation.mutate(msg);
	  };

		  const startForwardMessage = (msg: Message) => {
		    setForwardMessage(msg);
		    setForwardSearchQuery("");
		    setOpenMessageMenuId(null);
		  };

		  const clearAudioRecordingResources = () => {
		    if (audioRecordingTimerRef.current) {
		      clearInterval(audioRecordingTimerRef.current);
		      audioRecordingTimerRef.current = null;
		    }
		    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
		    audioStreamRef.current = null;
		    mediaRecorderRef.current = null;
		    audioChunksRef.current = [];
		    setIsRecordingAudio(false);
		    setAudioRecordingSeconds(0);
		  };

		  const stopAudioRecording = (send = true) => {
		    const recorder = mediaRecorderRef.current;
		    sendAudioAfterStopRef.current = send;
		    if (recorder && recorder.state !== "inactive") {
		      recorder.stop();
		      return;
		    }
		    clearAudioRecordingResources();
		  };

		  const startAudioRecording = async () => {
		    if (!activeChatId) {
		      toast.info("Selecciona un chat para grabar audio.");
		      return;
		    }
		    if (!currentPermissions.canReply || !currentPermissions.canSendMedia) {
		      toast.error("No tienes permiso para enviar mensajes de voz");
		      return;
		    }
		    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
		      toast.error("Este navegador no permite grabar audio.");
		      return;
		    }
		    try {
		      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		      const mimeType = supportedAudioRecordingMimeType();
		      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
		      audioStreamRef.current = stream;
		      mediaRecorderRef.current = recorder;
		      audioChunksRef.current = [];
		      sendAudioAfterStopRef.current = true;

		      recorder.ondataavailable = (event) => {
		        if (event.data.size > 0) {
		          audioChunksRef.current.push(event.data);
		        }
		      };

		      recorder.onerror = () => {
		        toast.error("No se pudo grabar el audio.");
		        sendAudioAfterStopRef.current = false;
		        clearAudioRecordingResources();
		      };

		      recorder.onstop = () => {
		        const shouldSend = sendAudioAfterStopRef.current;
		        sendAudioAfterStopRef.current = false;
		        const chunks = audioChunksRef.current;
		        const recordedMimeType = recorder.mimeType || mimeType || "audio/webm";
		        const blob = new Blob(chunks, { type: recordedMimeType });
		        clearAudioRecordingResources();
		        if (!shouldSend) return;
		        if (blob.size === 0) {
		          toast.error("El audio está vacío. Intenta grabar nuevamente.");
		          return;
		        }
		        const file = new File(
		          [blob],
		          `mensaje-voz-${Date.now()}${audioExtensionForMime(recordedMimeType)}`,
		          { type: recordedMimeType },
		        );
		        sendMediaFiles.mutate({ files: [file], caption: "", asVoice: true });
		      };

		      recorder.start();
		      setIsRecordingAudio(true);
		      setAudioRecordingSeconds(0);
		      audioRecordingTimerRef.current = setInterval(() => {
		        setAudioRecordingSeconds((seconds) => seconds + 1);
		      }, 1000);
		      closeMenus(setAttachmentMenuOpen, setEmojiOpen, setQuickReplyOpen);
		    } catch (err) {
		      clearAudioRecordingResources();
		      const message =
		        err instanceof DOMException && err.name === "NotAllowedError"
		          ? "Permite el micrófono para grabar mensajes de voz."
		          : "No se pudo acceder al micrófono.";
		      toast.error(message);
		    }
		  };

		  const handleSend = (e?: { preventDefault: () => void }) => {
    e?.preventDefault();
    if (!activeChatId) return;
	    if (!currentPermissions.canReply) {
	      toast.error("No tienes permiso para responder mensajes");
	      return;
	    }
	    if (containsBlockedPhoneNumber(messageInput)) {
	      toast.error(blockedPhoneNumberMessage);
	      return;
	    }
		    const outgoingBody = messageInput.trim();
		    if (pendingFiles.length > 0) {
		      if (!currentPermissions.canSendMedia) {
		        toast.error("No tienes permiso para enviar archivos");
		        return;
		      }
		      sendMediaFiles.mutate({ files: pendingFiles, caption: outgoingBody });
		      return;
		    }
		    if (!outgoingBody) return;
			    const quotedPreview = replyToMessage
			      ? {
			          body: messageActionText(replyToMessage),
			          authorLabel: replyToMessage.fromMe ? "Tú" : activeChatName || "Contacto",
			          fromMe: replyToMessage.fromMe,
			        }
			      : undefined;
			    sendMessage.mutate({
			      chatId: activeChatId,
			      body: outgoingBody,
			      quotedMessageId: replyToMessage?.id,
			      quotedPreview,
			      optimisticId: `local-${Date.now()}-${optimisticMessageSeqRef.current++}`,
			    });
			  };

  const handleDragOver = (event: React.DragEvent<HTMLElement>) => {
    if (!activeChatId || !Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    setIsDraggingFiles(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setIsDraggingFiles(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLElement>) => {
    if (!activeChatId) return;
    event.preventDefault();
    setIsDraggingFiles(false);
    addPendingFiles(event.dataTransfer.files);
  };

  const unreadTotal = chats?.reduce((count, chat) => count + Math.max(chat.unreadCount, 0), 0) ?? 0;
  const internalUnreadTotal = collaborators?.reduce((count, collaborator) => count + Math.max(collaborator.unreadInternalCount ?? 0, 0), 0) ?? 0;
  const assignableCollaborators = useMemo(
    () => (collaborators ?? []).filter((collaborator) => collaborator.role === "user"),
    [collaborators],
  );
  const pendingAssignedChats = useMemo(
    () =>
      (chats ?? [])
        .filter((chat) => chat.assignedTo?.userId === user?.id)
        .sort((a, b) => new Date(b.assignedTo?.assignedAt ?? 0).getTime() - new Date(a.assignedTo?.assignedAt ?? 0).getTime()),
    [chats, user?.id],
  );
  const selectedLabel = labels?.find((label) => label.id === selectedLabelId) ?? null;
  const agentSelectedLabels = labels?.filter((label) => agentSelectedLabelIds.includes(label.id)) ?? [];
  const canLoadAgentModels = !!agentOpenAiApiKey.trim() || !!agentSettings?.configured;
  const agentIsLive = agentEnabled && !!agentSettings?.configured;

  const toggleAgentLabel = (labelId: number) => {
    setAgentSelectedLabelIds((current) =>
      current.includes(labelId) ? current.filter((id) => id !== labelId) : [...current, labelId],
    );
  };

  const toggleAgentTraining = (key: AgentTrainingKind) => {
    setAgentTrainingEnabled((current) => ({ ...current, [key]: !current[key] }));
  };

  const openAgentTextRuleEditor = (rule?: AgentTextRule) => {
    setAgentTextRuleEditor({
      mode: rule ? "edit" : "create",
      ruleId: rule?.id,
      instructions: rule ? rule.response || rule.trigger : "",
    });
  };

  const saveAgentTextRule = () => {
    if (!agentTextRuleEditor) return;
    const instructions = agentTextRuleEditor.instructions.trim();
    if (!instructions) {
      toast.error("Agrega instrucciones de tu negocio.");
      return;
    }
    if (agentTextRuleEditor.mode === "edit" && agentTextRuleEditor.ruleId) {
      setAgentTextRules((current) =>
        current.map((rule) =>
          rule.id === agentTextRuleEditor.ruleId
            ? { ...rule, trigger: "Información del negocio", response: instructions }
            : rule,
        ),
      );
      toast.success("Regla actualizada");
    } else {
      setAgentTextRules((current) => [
        ...current,
        { id: localId("rule"), trigger: "Información del negocio", response: instructions },
      ]);
      toast.success("Regla guardada");
    }
    setAgentTextRuleEditor(null);
  };

  const removeAgentTextRule = (id: string) => {
    const firstConfirmation = window.confirm("¿Está seguro de eliminar esta regla?");
    if (!firstConfirmation) return;
    const secondConfirmation = window.confirm("Confirmación final: esta regla se eliminará. ¿Deseas continuar?");
    if (!secondConfirmation) return;
    setAgentTextRules((current) => current.filter((rule) => rule.id !== id));
    toast.success("Regla eliminada");
  };

  const addAgentTrainingAsset = (kind: AgentMediaTrainingKind, file?: File | null) => {
    if (!file) return;
    setAgentTrainingAssets((current) => ({
      ...current,
      [kind]: [...current[kind], { id: localId(kind), file, trigger: "" }],
    }));
  };

  const updateAgentTrainingAsset = (kind: AgentMediaTrainingKind, id: string, trigger: string) => {
    setAgentTrainingAssets((current) => ({
      ...current,
      [kind]: current[kind].map((asset) => (asset.id === id ? { ...asset, trigger } : asset)),
    }));
  };

  const removeAgentTrainingAsset = (kind: AgentMediaTrainingKind, id: string) => {
    setAgentTrainingAssets((current) => ({
      ...current,
      [kind]: current[kind].filter((asset) => asset.id !== id),
    }));
  };

  const visibleChats = useMemo(() => {
    if (!chats) return [];
    const q = searchQuery.trim().toLowerCase();
    const qDigits = digitsFromText(q);
    return chats
      .filter((c) => (showArchived ? c.archived : !c.archived))
      .filter((c) => (selectedLabelId ? c.labels.some((label) => label.id === selectedLabelId) : true))
      .filter((c) => {
        if (filter === "unread") return c.manuallyUnread || c.unreadCount > 0;
        if (filter === "favorites") return c.favorited;
        if (filter === "groups") return c.isGroup;
        return true;
      })
      .filter((c) => {
        const message = lastMessageText(c.lastMessage).toLowerCase();
        const visibleCode = displayChatCode(c).toLowerCase();
        const visibleDigits = verifiedChatDigits(c);
        const savedName = displayChatName(c).toLowerCase();
        return q
          ? visibleCode.includes(q) ||
              (qDigits ? visibleDigits.includes(qDigits) : false) ||
              savedName.includes(q) ||
              message.includes(q)
          : true;
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (a.favorited !== b.favorited) return a.favorited ? -1 : 1;
        return (b.timestamp ?? 0) - (a.timestamp ?? 0);
      });
  }, [chats, searchQuery, showArchived, filter, selectedLabelId]);

  useEffect(() => {
    if (!sessionId || visibleChats.length === 0) return;
    const prioritizedChatIds = [
      ...(activeChatId ? [activeChatId] : []),
      ...visibleChats.slice(0, 25).map((chat) => chat.id),
    ];
    const uniqueChatIds = Array.from(new Set(prioritizedChatIds));
    let cancelled = false;
    Promise.all(uniqueChatIds.map((chatId) => hydratePersistedMessages(chatId)))
      .then(() => {
        if (cancelled) return;
        const chatIds = uniqueChatIds.filter(
          (chatId) => !queryClient.getQueryData<Message[]>(["messages", sessionId, chatId]),
        );
        if (chatIds.length === 0) return null;
        return api<Record<string, Message[]>>(`/api/devices/${sessionId}/messages/snapshots`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatIds, limit: 100 }),
        });
      })
      .then((snapshots) => {
        if (cancelled || !snapshots) return;
        Object.entries(snapshots).forEach(([chatId, snapshot]) => {
          if (!snapshot.length) return;
          queryClient.setQueryData<Message[]>(["messages", sessionId, chatId], (old) =>
            old?.length ? old : snapshot,
          );
          void writeCachedMessages(sessionId, chatId, snapshot);
        });
      })
      .catch(() => {
        // Snapshot prefetch is a latency optimization; the regular message query remains the source of truth.
      });
    return () => {
      cancelled = true;
    };
  }, [activeChatId, hydratePersistedMessages, queryClient, sessionId, visibleChats]);

	  const archivedCount = chats?.filter((c) => c.archived).length ?? 0;
		  const activeChat = chats?.find((c) => c.id === activeChatId);
		  const activeChatName = displayChatTitle(activeChat);
		  const activeChatFullName = displayChatName(activeChat);
		  const activeChatCopyCode = copyableChatCode(activeChat);
		  const headerLabel = activeChat?.labels?.[0] ?? null;
		  const cachedActiveMessages =
		    sessionId && activeChatId
		      ? queryClient.getQueryData<Message[]>(["messages", sessionId, activeChatId])
		      : undefined;
		  const activeMessageSource = messages ?? cachedActiveMessages ?? [];
		  const showMessagesSyncing = isMessagesLoading && !activeMessageSource.length && !!activeChatId;
		  const activeMessages = useMemo(
		    () => activeMessageSource.filter((message) => !hiddenMessageIds.includes(message.id)),
		    [activeMessageSource, hiddenMessageIds],
		  );
  useEffect(() => {
    if (!activeChatId || activeMessagesPerfLoggedRef.current[activeChatId]) return;
    if (isMessagesLoading && activeMessages.length === 0) return;
    activeMessagesPerfLoggedRef.current[activeChatId] = true;
    const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - pageLoadStartedAtRef.current;
    if (elapsed > 3_000) {
      console.warn("[perf] La conversación activa tardó más de 3s en estar visible", {
        sessionId,
        chatId: activeChatId,
        elapsedMs: Math.round(elapsed),
        messageCount: activeMessages.length,
      });
    }
  }, [activeChatId, activeMessages.length, isMessagesLoading, sessionId]);
		  const normalizedChatSearchQuery = chatSearchQuery.trim().toLowerCase();
		  const chatSearchMatches = useMemo(
		    () =>
		      normalizedChatSearchQuery
		        ? activeMessages.filter((message) =>
		            searchableMessageText(message).toLowerCase().includes(normalizedChatSearchQuery),
		          )
		        : [],
		    [activeMessages, normalizedChatSearchQuery],
		  );
		  const activeSearchMessageId = chatSearchMatches[activeSearchMatchIndex]?.id ?? null;
			  const chatSearchMatchIds = useMemo(
			    () => new Set(chatSearchMatches.map((message) => message.id)),
			    [chatSearchMatches],
			  );
		  useEffect(() => {
		    setActiveSearchMatchIndex(0);
		  }, [normalizedChatSearchQuery, activeChatId]);

		  useEffect(() => {
		    if (activeSearchMatchIndex < chatSearchMatches.length) return;
		    setActiveSearchMatchIndex(Math.max(chatSearchMatches.length - 1, 0));
		  }, [activeSearchMatchIndex, chatSearchMatches.length]);

		  useEffect(() => {
		    if (!chatSearchOpen || !activeSearchMessageId) return;
		    messageSearchRefs.current[activeSearchMessageId]?.scrollIntoView({
		      block: "center",
		      behavior: "smooth",
		    });
		  }, [activeSearchMessageId, chatSearchOpen]);

			  const activeNotes = chatNotes ?? [];
	  const forwardTargets = useMemo(() => {
	    const query = forwardSearchQuery.trim().toLowerCase();
	    const queryDigits = digitsFromText(query);
	    return (chats ?? [])
	      .filter((chat) => chat.id !== activeChatId)
	      .filter((chat) => {
	        const code = displayChatCode(chat).toLowerCase();
	        const name = displayChatName(chat).toLowerCase();
	        const digits = verifiedChatDigits(chat);
	        return query
	          ? code.includes(query) ||
	              name.includes(query) ||
	              (queryDigits ? digits.includes(queryDigits) : false)
	          : true;
	      })
	      .slice(0, 30);
	  }, [activeChatId, chats, forwardSearchQuery]);
  const { data: groupParticipantsResponse, isFetching: isGroupParticipantsFetching } =
    useQuery<GroupParticipantsResponse>({
      queryKey: ["group-participants", sessionId, activeChatId],
      queryFn: () =>
        api<GroupParticipantsResponse>(
          `/api/devices/${sessionId}/chats/${encodeURIComponent(activeChatId!)}/group-participants`,
        ),
      enabled: !!sessionId && !!activeChatId && !!activeChat?.isGroup && detailsPanelOpen,
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      retry: false,
    });
  const activeGroupParticipants = useMemo(() => {
    if (!activeChat?.isGroup) return [];
    const liveParticipants = groupParticipantsResponse?.participants ?? [];
    return liveParticipants.length > 0 ? liveParticipants : activeChat.participants ?? [];
  }, [activeChat, groupParticipantsResponse]);
  const participantDigitsById = useMemo(() => {
    const byId = new Map<string, string>();
    activeGroupParticipants.forEach((participant) => {
      const digits = verifiedParticipantDigits(participant);
      if (digits) byId.set(participant.id, digits);
    });
    return byId;
  }, [activeGroupParticipants]);
  const groupMemberCodes = useMemo(() => {
    if (!activeChat?.isGroup) return [];
    type GroupMemberCode = {
      id: string;
      ids: Set<string>;
      code: string;
      label: string;
      chatId?: string;
      ambiguous: boolean;
    };
    const byCode = new Map<string, GroupMemberCode>();
    const addVerifiedMember = (id: string, digits: string) => {
      if (digits.length < 6) return;
      const compact = digits.slice(-6);
      const existing = byCode.get(compact);
      if (existing) {
        if (existing.ids.has(id)) return;
        existing.ids.add(id);
        existing.chatId = undefined;
        existing.ambiguous = true;
        existing.label = `${formatSixDigitCode(compact)} duplicado`;
        return;
      }
      const matchedChats = (chats ?? []).filter(
        (chat) => !chat.isGroup && verifiedChatDigits(chat).slice(-6) === compact,
      );
      const matchedChat = matchedChats.length === 1 ? matchedChats[0] : undefined;
      const ambiguous = matchedChats.length > 1;
      byCode.set(compact, {
        id: compact,
        ids: new Set([id]),
        code: formatSixDigitCode(compact),
        label: ambiguous ? `${formatSixDigitCode(compact)} duplicado` : matchedChat ? displayChatCode(matchedChat) : formatSixDigitCode(compact),
        chatId: ambiguous ? undefined : matchedChat?.id,
        ambiguous,
      });
    };

    activeGroupParticipants.forEach((participant) =>
      addVerifiedMember(participant.id, verifiedParticipantDigits(participant)),
    );
    activeMessages.forEach((message) => {
      const authorDigits = (message.author ? participantDigitsById.get(message.author) : "") || trustedDigitsFromWaId(message.author);
      if (message.author && authorDigits) addVerifiedMember(message.author, authorDigits);
    });

    return Array.from(byCode.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [activeChat, activeGroupParticipants, activeMessages, chats, participantDigitsById]);
  const mediaItems = useMemo(
    () => activeMessages.filter((msg) => msg.hasMedia && isVisualMediaMessage(msg) && !!msg.mediaUrl),
    [activeMessages],
  );
  const documentItems = useMemo(
    () => activeMessages.filter((msg) => isDocumentMessage(msg)),
    [activeMessages],
  );
  const linkItems = useMemo(
    () =>
      activeMessages.flatMap((msg) =>
        extractLinks(msg.body || "").map((url) => ({
          id: `${msg.id}:${url}`,
          url,
          host: linkHost(url),
          body: sanitizePreview(msg.body || url),
          timestamp: msg.timestamp,
          fromMe: msg.fromMe,
        })),
      ),
    [activeMessages],
  );
  const mediaSummaryCount = mediaItems.length + documentItems.length + linkItems.length;
  const menuIconClass = "h-5 w-5 shrink-0 text-[#111b21]";
  const appMenuItems = [
    { label: "Herramientas para la empresa", icon: <Briefcase className={menuIconClass} /> },
    { label: "Nuevo grupo", icon: <Users className={menuIconClass} /> },
    { label: "Catálogo", icon: <List className={menuIconClass} /> },
    { label: "Pedidos", icon: <ShoppingBag className={menuIconClass} /> },
    { label: "Archivados", icon: <Archive className={menuIconClass} /> },
    { label: "Respuestas rápidas", icon: <Zap className={menuIconClass} /> },
    { label: "Mensajes destacados", icon: <Star className={menuIconClass} /> },
    { label: "Seleccionar chats", icon: <CheckSquare className={menuIconClass} /> },
    { label: "Etiquetas", icon: <Tag className={menuIconClass} /> },
    { label: "Marcar todos como leídos", icon: <MessageSquare className={menuIconClass} /> },
  ];
	  const chatMenuItems = [
	    { key: "info", label: "Info. del contacto", icon: <Info className={menuIconClass} /> },
	    { key: "search", label: "Buscar", icon: <Search className={menuIconClass} /> },
	    { key: "select", label: "Seleccionar mensajes", icon: <CheckSquare className={menuIconClass} /> },
    {
      key: "mute",
	      label: activeChat?.muted ? "Reactivar notificaciones" : "Silenciar notificaciones",
	      icon: <VolumeX className={`${menuIconClass} ${activeChat?.muted ? "text-[#008069]" : ""}`} />,
	    },
	    {
	      key: "pin",
	      label: activeChat?.pinned ? "Desfijar chat" : "Fijar chat",
	      icon: <Pin className={`${menuIconClass} ${activeChat?.pinned ? "text-[#008069]" : ""}`} />,
	    },
	    { key: "assign", label: "Derivar chat", icon: <Forward className={menuIconClass} /> },
	    { key: "close", label: "Cerrar chat", icon: <XCircle className={menuIconClass} /> },
	  ];

  const handleChatMenuAction = (key: string) => {
    setChatMenuOpen(false);
    if (key === "info") {
      setDetailsPanelOpen(true);
      setMediaPanelOpen(false);
      setPendingPanelOpen(false);
      return;
    }
	    if (key === "search") {
	      openChatSearch();
	      return;
	    }
    if (key === "select") {
      toast.info("Selección de mensajes en preparación.");
      return;
    }
	    if (key === "mute" && activeChat) {
	      mutateChatState.mutate({
	        chat: activeChat,
	        patch: { muted: !activeChat.muted },
	      });
	      return;
	    }
	    if (key === "pin" && activeChat) {
	      mutateChatState.mutate({
	        chat: activeChat,
	        patch: { pinned: !activeChat.pinned },
	      });
	      return;
	    }
    if (key === "assign" && activeChat) {
      setAssignmentTargetChat(activeChat);
      return;
    }
    if (key === "close") {
      setActiveChatId(null);
    }
  };

  const selectChat = (chatId: string) => {
    prefetchChatMessages(chatId);
    setActiveChatId(chatId);
    closeMenus(
      setLabelMenuOpen,
      setAppMenuOpen,
      setChatMenuOpen,
      setHeaderLabelsOpen,
      setAttachmentMenuOpen,
      setEmojiOpen,
      setQuickReplyOpen,
    );
  };

  const renderChatRowMenuItems = (
    chat: Chat,
    labelIdsOnChat: Set<number>,
    parts: {
      Item: React.ElementType;
      Separator: React.ElementType;
      Sub: React.ElementType;
      SubTrigger: React.ElementType;
      SubContent: React.ElementType;
    },
  ) => {
    const { Item, Separator, Sub, SubTrigger, SubContent } = parts;
    return (
      <>
        <Item
          onSelect={() =>
            mutateChatState.mutate({
              chat,
              patch: { archived: !chat.archived },
            })
          }
        >
          {chat.archived ? (
            <>
              <ArchiveRestore className="mr-2 h-4 w-4" /> Desarchivar chat
            </>
          ) : (
            <>
              <Archive className="mr-2 h-4 w-4" /> Archivar chat
            </>
          )}
        </Item>
        <Sub>
          <SubTrigger>
            <Tag className="mr-2 h-4 w-4" /> Etiquetar chat
          </SubTrigger>
          <SubContent className="w-56">
            {labels && labels.length > 0 ? (
              labels.map((l) => (
                <Item
                  key={l.id}
                  className="flex items-center gap-2"
                  disabled={!currentPermissions.canManageLabels || toggleLabelOnChat.isPending}
                  onSelect={() => {
                    toggleLabelOnChat.mutate({
                      chat,
                      labelId: l.id,
                      attached: labelIdsOnChat.has(l.id),
                    });
                  }}
                >
                  <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: l.color }} />
                  <span className="min-w-0 flex-1 truncate">{l.name}</span>
                  <span
                    className={`grid h-5 w-5 place-items-center rounded border ${
                      labelIdsOnChat.has(l.id)
                        ? "border-[#111b21] bg-[#111b21] text-white"
                        : "border-[#9aa3a9] bg-white"
                    }`}
                  >
                    {labelIdsOnChat.has(l.id) ? <Check className="h-3.5 w-3.5" /> : null}
                  </span>
                </Item>
              ))
            ) : (
              <Item disabled>Sin etiquetas</Item>
            )}
            <Separator />
            <Link href="/labels">
              <Item>
                <Tags className="mr-2 h-4 w-4" /> Gestionar etiquetas
              </Item>
            </Link>
          </SubContent>
        </Sub>
        <Sub>
          <SubTrigger>
            <Forward className="mr-2 h-4 w-4" /> Derivar chat
          </SubTrigger>
          <SubContent className="w-60">
            {assignableCollaborators.length > 0 ? (
              assignableCollaborators.map((collaborator) => (
                <Item
                  key={collaborator.id}
                  disabled={!currentPermissions.canManageChats || assignChat.isPending}
                  onSelect={() => assignChat.mutate({ chat, collaborator })}
                >
                  <span
                    className="mr-2 h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: collaborator.labelColor || COLLABORATOR_COLOR_OPTIONS[0] }}
                  />
                  <span className="min-w-0 flex-1 truncate">{collaborator.displayName}</span>
                </Item>
              ))
            ) : (
              <Item disabled>Sin colaboradores</Item>
            )}
            {chat.assignedTo ? (
              <>
                <Separator />
                <Item
                  disabled={!currentPermissions.canManageChats || assignChat.isPending}
                  onSelect={() => assignChat.mutate({ chat, collaborator: null })}
                >
                  <X className="mr-2 h-4 w-4" /> Quitar derivación
                </Item>
              </>
            ) : null}
          </SubContent>
        </Sub>
        <Item
          onSelect={() =>
            mutateChatState.mutate({
              chat,
              patch: { muted: !chat.muted },
            })
          }
        >
          <VolumeX className={`mr-2 h-4 w-4 ${chat.muted ? "text-[#008069]" : ""}`} />
          {chat.muted ? "Reactivar notificaciones" : "Silenciar notificaciones"}
        </Item>
        <Item
          onSelect={() =>
            mutateChatState.mutate({
              chat,
              patch: { pinned: !chat.pinned },
            })
          }
        >
          <Pin className="mr-2 h-4 w-4" /> {chat.pinned ? "Desfijar chat" : "Fijar chat"}
        </Item>
        <Item
          onSelect={() =>
            mutateChatState.mutate({
              chat,
              patch: { favorited: !chat.favorited },
            })
          }
        >
          <Star className={`mr-2 h-4 w-4 ${chat.favorited ? "fill-amber-400 text-amber-400" : ""}`} />
          {chat.favorited ? "Quitar destacado" : "Destacar chat"}
        </Item>
        <Item onSelect={() => mutateChatState.mutate({ chat, patch: { manuallyUnread: true } })}>
          <MailPlus className="mr-2 h-4 w-4" /> Marcar como no leído
        </Item>
        <Separator />
        <Item onSelect={() => toast.info("Bloqueo disponible desde WhatsApp.")}>
          <Ban className="mr-2 h-4 w-4" /> Bloquear
        </Item>
        <Item onSelect={() => toast.info("Vaciar chat no borra mensajes en WhatsApp desde este panel.")}>
          <Eraser className="mr-2 h-4 w-4" /> Vaciar chat
        </Item>
        <Item disabled={!currentPermissions.canManageChats} onSelect={() => editChatCustomName(chat)}>
          <Pencil className="mr-2 h-4 w-4" />
          {savedChatName(chat) ? "Editar nombre de este usuario" : "Agregar nombre a este usuario"}
        </Item>
        {savedChatName(chat) ? (
          <Item disabled={!currentPermissions.canManageChats} onSelect={() => removeChatCustomName(chat)}>
            <User className="mr-2 h-4 w-4" /> Eliminar nombre guardado
          </Item>
        ) : null}
        <Item
          className="text-[#b42318] focus:text-[#b42318]"
          onSelect={() => toast.info("No se pueden eliminar conversaciones desde el CRM.")}
        >
          <Trash2 className="mr-2 h-4 w-4" /> Eliminar chat
        </Item>
      </>
    );
  };

  const attachmentItems: Array<{
    label: string;
    icon: React.ReactNode;
    action?: "document" | "media";
    quickReply?: boolean;
  }> = [
    { label: "Documento", icon: <FileIcon className="h-6 w-6 text-[#7064ff]" />, action: "document" },
    { label: "Fotos y videos", icon: <Image className="h-6 w-6 text-[#3b82f6]" />, action: "media" },
    { label: "Cámara", icon: <Camera className="h-6 w-6 text-[#f0487a]" />, action: "media" },
    { label: "Audio", icon: <Headphones className="h-6 w-6 text-[#ef5b3f]" /> },
    { label: "Contacto", icon: <Contact className="h-6 w-6 text-[#3a9bdc]" /> },
    { label: "Encuesta", icon: <List className="h-6 w-6 text-[#ffb02e]" /> },
    { label: "Evento", icon: <Calendar className="h-6 w-6 text-[#f04e7d]" /> },
    { label: "Nuevo sticker", icon: <Sticker className="h-6 w-6 text-[#58c783]" /> },
    { label: "Catálogo", icon: <Package className="h-6 w-6 text-[#59616a]" /> },
    { label: "Respuestas rápidas", icon: <Zap className="h-6 w-6 text-[#f5b22e]" />, quickReply: true },
    { label: "Pedido", icon: <ShoppingBag className="h-6 w-6 text-[#4a9bd9]" /> },
  ];
  const emojiList = [
    "🤣", "😢", "✅", "☺️", "👀", "😞", "💔", "🥰", "👍", "🫰", "💸", "📣",
    "😀", "😃", "😄", "😁", "😆", "🥹", "😅", "😂", "🥲", "😊", "🙂", "😇",
    "😉", "😌", "😍", "😘", "😗", "😙", "😚", "😋", "😛", "😝", "😜", "🤓",
    "😎", "🥳", "😏", "😒", "😔", "😟", "🙁", "☹️", "😖", "😫", "😩", "🥺",
    "😭", "😤", "😡", "🤯", "😳", "🤪", "🥶", "😱", "😨", "😰", "😥", "🤗",
    "🤔", "🤭", "🫢", "🤫", "🤥", "😶", "🙄", "😬", "🫡", "🙏", "👏", "🔥",
  ];

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-[#efeae2] text-[#111b21]">
      <aside className="hidden w-[74px] shrink-0 flex-col items-end border-r border-[#d1d7db] bg-[#f7f8f8] py-3 pr-2 md:flex">
        <RailButton
          active={leftPanel === "chats"}
          tooltip="Chats"
          badge={unreadTotal}
          onClick={() => setLeftPanel("chats")}
        >
          <MessageCircle className="h-[22px] w-[22px] fill-current stroke-[1.8]" />
        </RailButton>
        <div className="mt-2 flex flex-col items-center gap-2">
          <RailButton
            active={leftPanel === "labels"}
            tooltip="Etiquetas"
            onClick={() => setLeftPanel("labels")}
          >
            <Tags className="h-[22px] w-[22px] stroke-[1.8]" />
          </RailButton>
          <RailButton
            active={leftPanel === "quickReplies"}
            tooltip="Respuestas rápidas"
            onClick={() => setLeftPanel("quickReplies")}
          >
            <Zap className="h-[22px] w-[22px] stroke-[1.8]" />
          </RailButton>
        </div>
        <div className="my-4 h-px w-9 bg-[#dbe0e3]" />
        <RailButton
          tooltip="Atrás"
          onClick={() => {
            if (window.history.length > 1) {
              window.history.back();
            } else {
              setLocation("/devices");
            }
          }}
        >
          <ArrowLeft className="h-[22px] w-[22px] stroke-[1.8]" />
        </RailButton>
        <div className="mt-2">
          <RailButton
            active={leftPanel === "team"}
            tooltip="Equipo"
            badge={internalUnreadTotal}
            onClick={() => setLeftPanel("team")}
          >
            <Users className="h-[22px] w-[22px] stroke-[1.8]" />
          </RailButton>
        </div>
        <div className="mt-auto flex flex-col items-center gap-2">
          <RailButton
            active={agentPanelOpen}
            live={agentIsLive}
            tooltip="Agente IA"
            onClick={() => {
              setAgentPanelOpen(true);
              closeMenus(setLabelMenuOpen, setAppMenuOpen, setChatMenuOpen, setHeaderLabelsOpen, setAttachmentMenuOpen, setEmojiOpen, setQuickReplyOpen);
            }}
          >
            <span className="text-[22px] leading-none" aria-hidden="true">
              🙋
            </span>
          </RailButton>
          {isAdmin ? (
            <RailButton
              active={leftPanel === "settings"}
              tooltip="Configuración"
              onClick={() => setLeftPanel("settings")}
            >
              <Settings className="h-[22px] w-[22px] stroke-[1.8]" />
            </RailButton>
          ) : null}
          <button
            type="button"
            onClick={logout}
            className="grid h-[38px] w-[38px] place-items-center rounded-full text-[#5f6f77] transition-colors hover:bg-[#e6eaed] hover:text-[#111b21]"
            aria-label="Cerrar sesión"
          >
            <LogOut className="h-[21px] w-[21px] stroke-[1.8]" />
          </button>
          <div className="grid h-[38px] w-[38px] place-items-center overflow-hidden rounded-full bg-[#d7e9ff] text-[#0b65c2]">
            <span className="text-xs font-bold">{initials(user?.displayName || "U")}</span>
          </div>
        </div>
      </aside>

      <section className="flex w-full min-w-[320px] shrink-0 flex-col border-r border-[#d1d7db] bg-[#fbfbfa] md:ml-2 md:w-[400px] md:max-w-[29vw] xl:w-[408px]">
        {leftPanel === "quickReplies" ? (
          <>
            <header className="flex h-[70px] shrink-0 items-center gap-4 px-5">
              <button
                type="button"
                onClick={() => setLeftPanel("chats")}
                className="grid h-10 w-10 place-items-center rounded-full hover:bg-[#f0f2f5]"
                aria-label="Volver a chats"
              >
                <X className="h-7 w-7" />
              </button>
              <h1 className="text-[22px] font-semibold leading-none tracking-normal">Respuestas rápidas</h1>
              <button
                type="button"
                onClick={() => setQuickReplyDialogOpen(true)}
                className="ml-auto grid h-10 w-10 place-items-center rounded-full bg-[#f7f8f8] hover:bg-[#f0f2f5]"
                aria-label="Añadir respuesta rápida"
              >
                <Plus className="h-6 w-6" />
              </button>
            </header>
            <ScrollArea className="flex-1">
              <div className="px-4 pb-6 pt-2">
                {quickReplies && quickReplies.length > 0 ? (
                  quickReplies.map((reply) => (
                    <button
                      key={reply.id}
                      type="button"
                      onClick={() => {
                        if (activeChatId) {
                          sendQuickReply.mutate(reply.id);
                        } else {
                          toast.info("Selecciona un chat para enviar esta respuesta.");
                        }
                      }}
                      className="flex w-full flex-col rounded-xl px-3 py-4 text-left hover:bg-[#f5f6f6]"
                    >
                      <span className="truncate text-[17px] font-semibold text-[#111b21]">
                        {reply.title || reply.shortcut}
                      </span>
                      <span className="mt-1 line-clamp-2 text-[15px] leading-5 text-[#667781]">
                        {reply.body || `${reply.attachments.length} adjunto${reply.attachments.length === 1 ? "" : "s"}`}
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="px-6 py-12 text-center text-[15px] text-[#667781]">
                    Sin respuestas rápidas.
                  </div>
                )}
              </div>
            </ScrollArea>
            {quickReplyDialogOpen ? (
              <div className="absolute inset-0 z-[80] grid place-items-center bg-black/35 px-5">
                <div className="w-full max-w-[520px] rounded-2xl bg-white p-6 shadow-[0_18px_45px_rgba(11,20,26,0.28)]">
                  <div className="mb-8 flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => setQuickReplyDialogOpen(false)}
                      className="grid h-10 w-10 place-items-center rounded-full hover:bg-[#f0f2f5]"
                      aria-label="Cerrar"
                    >
                      <X className="h-7 w-7" />
                    </button>
                    <h2 className="text-[22px] font-semibold">Añade una respuesta rápida</h2>
                  </div>
                  <label className="block border-b-2 border-[#00a884] pb-2">
                    <span className="sr-only">Acceso directo</span>
                    <input
                      value={quickReplyShortcut}
                      onChange={(event) => setQuickReplyShortcut(event.target.value.replace(/\s+/g, "").slice(0, 25))}
                      placeholder="Acceso directo"
                      className="w-full border-0 bg-transparent text-[20px] outline-none placeholder:text-[#667781]"
                      maxLength={25}
                    />
                  </label>
                  <label className="mt-8 block border-b border-[#aebac1] pb-2">
                    <span className="sr-only">Título</span>
                    <input
                      value={quickReplyTitle}
                      onChange={(event) => setQuickReplyTitle(event.target.value)}
                      placeholder="Título"
                      className="w-full border-0 bg-transparent text-[18px] outline-none placeholder:text-[#667781]"
                      maxLength={80}
                    />
                  </label>
                  <label className="mt-8 block border-b-2 border-[#aebac1] pb-2">
                    <span className="sr-only">Mensaje de respuesta</span>
                    <textarea
                      value={quickReplyBody}
                      onChange={(event) => setQuickReplyBody(event.target.value)}
                      placeholder="Mensaje de respuesta"
                      className="min-h-28 w-full resize-none border-0 bg-transparent text-[18px] outline-none placeholder:text-[#667781]"
                      maxLength={4000}
                    />
                  </label>
                  <div className="mt-8 flex justify-end gap-4">
                    <button
                      type="button"
                      onClick={() => setQuickReplyDialogOpen(false)}
                      className="rounded-full px-6 py-3 text-[15px] font-semibold text-[#008069] hover:bg-[#f5f6f6]"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={!quickReplyShortcut.trim() || (!quickReplyTitle.trim() && !quickReplyBody.trim()) || createQuickReply.isPending}
                      onClick={() => createQuickReply.mutate()}
                      className="rounded-full bg-[#008069] px-7 py-3 text-[15px] font-semibold text-white disabled:bg-[#f0f2f5] disabled:text-[#aebac1]"
                    >
                      Guardar
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        ) : isAdmin && leftPanel === "settings" ? (
          <>
            <header className="flex h-[70px] shrink-0 items-center gap-4 px-5">
              <button
                type="button"
                onClick={() => setLeftPanel("chats")}
                className="grid h-10 w-10 place-items-center rounded-full hover:bg-[#f0f2f5]"
                aria-label="Volver a chats"
              >
                <X className="h-7 w-7" />
              </button>
              <h1 className="text-[22px] font-semibold leading-none tracking-normal">Configuración</h1>
            </header>
            <ScrollArea className="flex-1">
              <div className="space-y-6 px-5 pb-8 pt-3">
                <section className="rounded-xl border border-[#e4e7e8] p-4">
                  <h2 className="text-[17px] font-semibold">Colaboradores</h2>
                  <p className="mt-1 text-[13px] leading-5 text-[#667781]">
                    Usuarios internos con acceso al CRM de WhatsApp.
                  </p>
                  {isAdmin ? (
                    <div className="mt-4 space-y-3">
                      <div className="flex gap-2">
                        <input
                          value={collaboratorName}
                          onChange={(event) => setCollaboratorName(event.target.value)}
                          placeholder="Nombre"
                          className="h-11 min-w-0 flex-1 rounded-lg border border-[#d1d7db] px-3 text-[15px] outline-none focus:border-[#00a884]"
                        />
                        <label
                          className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-lg border border-[#d1d7db] bg-white"
                          title="Color de etiqueta del colaborador"
                          aria-label="Color de etiqueta del colaborador"
                        >
                          <span className="h-5 w-5 rounded-full" style={{ backgroundColor: collaboratorColor }} />
                          <input
                            type="color"
                            value={collaboratorColor}
                            onChange={(event) => setCollaboratorColor(event.target.value)}
                            className="sr-only"
                          />
                        </label>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {COLLABORATOR_COLOR_OPTIONS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            onClick={() => setCollaboratorColor(color)}
                            className={`h-5 w-5 rounded-full border ${
                              collaboratorColor === color ? "border-[#111b21] ring-2 ring-[#d1d7db]" : "border-white"
                            }`}
                            style={{ backgroundColor: color }}
                            aria-label={`Usar color ${color}`}
                          />
                        ))}
                      </div>
                      <input
                        value={collaboratorEmail}
                        onChange={(event) => setCollaboratorEmail(event.target.value)}
                        placeholder="Usuario: correo"
                        className="h-11 w-full rounded-lg border border-[#d1d7db] px-3 text-[15px] outline-none focus:border-[#00a884]"
                        type="email"
                      />
                      <input
                        value={collaboratorPassword}
                        onChange={(event) =>
                          setCollaboratorPassword(event.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 6))
                        }
                        placeholder="Contraseña: 6 letras o números"
                        className="h-11 w-full rounded-lg border border-[#d1d7db] px-3 text-[15px] outline-none focus:border-[#00a884]"
                        maxLength={6}
                      />
                      <button
                        type="button"
                        disabled={
                          !collaboratorName.trim() ||
                          !collaboratorEmail.trim() ||
                          collaboratorPassword.length !== 6 ||
                          createCollaborator.isPending
                        }
                        onClick={() => createCollaborator.mutate()}
                        className="h-11 w-full rounded-lg bg-[#008069] text-[15px] font-semibold text-white disabled:bg-[#f0f2f5] disabled:text-[#aebac1]"
                      >
                        Registrar colaborador
                      </button>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-lg bg-[#f7f8f8] px-3 py-3 text-[14px] text-[#667781]">
                      Solo un administrador puede registrar colaboradores.
                    </div>
                  )}
                </section>
                <section className="rounded-xl border border-[#e4e7e8] p-4">
                  <h2 className="mb-2 text-[17px] font-semibold">Accesos activos</h2>
                  <div className="divide-y divide-[#eef0f2]">
                    {(collaborators ?? []).map((collaborator) => (
                      <div key={collaborator.id} className="flex items-center gap-3 py-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#d7e9ff] text-[13px] font-bold text-[#0b65c2]">
                          {initials(collaborator.displayName)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="block truncate text-[15px] font-semibold">{collaborator.displayName}</span>
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: collaborator.labelColor || COLLABORATOR_COLOR_OPTIONS[0] }}
                            />
                          </span>
                          <span className="block truncate text-[13px] text-[#667781]">{collaborator.username}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="rounded-full bg-[#f0f2f5] px-2 py-1 text-[11px] font-semibold uppercase text-[#667781]">
                            {collaborator.role === "admin" ? "admin" : "colaborador"}
                          </span>
                          {collaborator.role === "user" ? (
                            <button
                              type="button"
                              onClick={() => {
                                setPermissionDraft(normalizeCollaboratorPermissions(collaborator.permissions));
                                setPermissionTargetId(collaborator.id);
                              }}
                              className="grid h-8 w-8 place-items-center rounded-full text-[#667781] hover:bg-[#eef2f3] hover:text-[#111b21]"
                              aria-label={`Configurar permisos de ${collaborator.displayName}`}
                            >
                              <Settings className="h-4 w-4" />
                            </button>
                          ) : null}
                        </span>
                      </div>
                    ))}
                    {isAdmin && collaborators?.length === 0 ? (
                      <div className="py-6 text-center text-[14px] text-[#667781]">Sin colaboradores.</div>
                    ) : null}
                  </div>
                </section>
              </div>
            </ScrollArea>
          </>
	        ) : leftPanel === "team" ? (
	          <>
	            <header className="flex h-[70px] shrink-0 items-center gap-4 px-5">
	              <button
	                type="button"
	                onClick={() => {
	                  if (activeTeamUser) {
	                    setActiveTeamUserId(null);
	                  } else {
	                    setLeftPanel("chats");
	                  }
	                }}
	                className="grid h-10 w-10 place-items-center rounded-full hover:bg-[#f0f2f5]"
	                aria-label="Volver"
	              >
	                {activeTeamUser ? <ArrowLeft className="h-6 w-6" /> : <X className="h-7 w-7" />}
	              </button>
	              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#e7f3ef] text-[#008069]">
	                <Users className="h-5 w-5" />
	              </div>
	              <div className="min-w-0 flex-1">
	                <h1 className="truncate text-[22px] font-semibold leading-none tracking-normal">
	                  {activeTeamUser ? activeTeamUser.displayName : "Equipo"}
	                </h1>
	                <p className="mt-1 truncate text-[12px] text-[#667781]">
	                  {activeTeamUser
	                    ? activeTeamUser.online
	                      ? "Conectado"
	                      : "Desconectado"
	                    : "Colaboradores internos"}
	                </p>
	              </div>
	            </header>
	            {!activeTeamUser ? (
	              <ScrollArea className="flex-1">
	                <div className="px-3 pb-6 pt-2">
	                  {(collaborators ?? []).map((collaborator) => {
	                    const isCurrentUser = collaborator.id === user?.id;
	                    const unread = Math.max(collaborator.unreadInternalCount ?? 0, 0);
	                    const row = (
	                      <button
	                        type="button"
	                        disabled={isCurrentUser}
	                        onClick={() => {
	                          if (isCurrentUser) return;
	                          setActiveTeamUserId(collaborator.id);
	                        }}
	                        className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-[#f0f2f5] disabled:cursor-default disabled:hover:bg-transparent"
	                      >
	                        <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#d7e9ff] text-[13px] font-bold text-[#0b65c2]">
	                          {initials(collaborator.displayName)}
	                          <span
	                            className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white ${
	                              collaborator.online ? "bg-[#1fa855]" : "bg-[#c9d1d6]"
	                            }`}
	                            aria-label={collaborator.online ? "Conectado" : "Desconectado"}
	                          />
	                        </span>
	                        <span className="min-w-0 flex-1">
	                          <span className="flex min-w-0 items-center gap-2">
	                            <span className="truncate text-[15px] font-semibold text-[#111b21]">
	                              {collaborator.displayName}
	                            </span>
	                            <span
	                              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
	                                collaborator.online ? "bg-[#1fa855]" : "bg-[#c9d1d6]"
	                              }`}
	                            />
	                          </span>
	                          <span className="block truncate text-[12px] text-[#667781]">
	                            {isCurrentUser ? "Tú" : collaborator.username}
	                          </span>
	                        </span>
	                        {unread > 0 ? (
	                          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#d93025] px-1.5 text-[11px] font-bold leading-none text-white">
	                            {unread > 99 ? "99+" : unread}
	                          </span>
	                        ) : null}
	                      </button>
	                    );
	                    if (isCurrentUser) return <div key={collaborator.id}>{row}</div>;
	                    return (
	                      <ContextMenu key={collaborator.id}>
	                        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
	                        <ContextMenuContent className="w-56">
	                          <ContextMenuItem onSelect={() => setActiveTeamUserId(collaborator.id)}>
	                            <MessageCircle className="mr-2 h-4 w-4" />
	                            Enviar mensaje interno
	                          </ContextMenuItem>
	                        </ContextMenuContent>
	                      </ContextMenu>
	                    );
	                  })}
	                  {collaborators?.length === 0 ? (
	                    <div className="px-6 py-12 text-center text-[14px] text-[#667781]">Sin colaboradores.</div>
	                  ) : null}
	                </div>
	              </ScrollArea>
	            ) : (
	              <div
	                className="flex min-h-0 flex-1 flex-col"
	                onDragOver={(event) => {
	                  event.preventDefault();
	                  setIsDraggingTeamFiles(true);
	                }}
	                onDragLeave={(event) => {
	                  if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
	                  setIsDraggingTeamFiles(false);
	                }}
	                onDrop={(event) => {
	                  event.preventDefault();
	                  setIsDraggingTeamFiles(false);
	                  addTeamFiles(event.dataTransfer.files);
	                }}
	              >
	                <ScrollArea className="min-h-0 flex-1">
	                  <div className="space-y-2 px-4 pb-4 pt-2">
	                    {showTeamMessagesLoading ? (
	                      <div className="rounded-lg bg-white px-3 py-2 text-center text-[13px] text-[#667781]">
	                        Cargando mensajes internos...
	                      </div>
	                    ) : displayedTeamMessages.length === 0 ? (
	                      <div className="rounded-lg border border-dashed border-[#d1d7db] px-4 py-8 text-center text-[13px] text-[#667781]">
	                        Sin mensajes internos.
	                      </div>
	                    ) : (
	                      displayedTeamMessages.map((message) => {
	                        const fromMe = message.senderUserId === user?.id;
	                        const fileKind = noteFileKind({
	                          fileName: message.fileName,
	                          fileMimeType: message.fileMimeType,
	                        });
	                        return (
	                          <div key={message.id} className={`flex flex-col ${fromMe ? "items-end" : "items-start"}`}>
	                            <div
	                              className={`max-w-[88%] rounded-xl px-3 py-2 text-[13px] leading-5 shadow-sm ${
	                                fromMe ? "bg-[#d9fdd3]" : "bg-white"
	                              }`}
	                            >
	                              {!fromMe ? (
	                                <div className="mb-1 text-[11px] font-semibold text-[#008069]">
	                                  {message.senderDisplayName}
	                                </div>
	                              ) : null}
	                              {message.fileUrl && message.fileName ? (
	                                <div className={message.body ? "mb-2" : ""}>
	                                  {fileKind === "image" ? (
	                                    <button
	                                      type="button"
	                                      onClick={() => setImagePreview({ src: message.fileUrl || "", alt: message.fileName || "Imagen" })}
	                                      className="block overflow-hidden rounded-lg"
	                                      aria-label="Abrir imagen interna"
	                                    >
	                                      <img src={message.fileUrl} alt={message.fileName} className="max-h-44 w-full object-cover" />
	                                    </button>
	                                  ) : fileKind === "video" ? (
	                                    <VideoPreview src={message.fileUrl} compact />
	                                  ) : message.fileMimeType?.startsWith("audio/") ? (
	                                    <AudioPreview src={message.fileUrl} name={message.fileName} />
	                                  ) : (
	                                    <DocumentPreview
	                                      name={message.fileName}
	                                      mimeType={message.fileMimeType}
	                                      href={message.fileUrl}
	                                      compact
	                                    />
	                                  )}
	                                </div>
	                              ) : null}
	                              {message.body ? (
	                                <LinkifiedText text={message.body} className="whitespace-pre-wrap break-words" />
	                              ) : null}
	                              <div className="mt-1 text-right text-[10px] leading-none text-[#667781]">
	                                {formatNoteTime(message.createdAt)}
	                              </div>
	                            </div>
	                          </div>
	                        );
	                      })
	                    )}
	                    <div ref={teamMessagesEndRef} />
	                  </div>
	                </ScrollArea>
	                <form
	                  className="border-t border-[#e4e7e8] bg-white px-3 py-3"
	                  onSubmit={(event) => {
	                    event.preventDefault();
	                    if (!activeTeamUser || sendTeamMessage.isPending) return;
	                    sendTeamMessage.mutate({
	                      recipientUser: activeTeamUser,
	                      body: teamMessageInput,
	                      files: teamMessageFiles,
	                    });
	                  }}
	                >
	                  <input
	                    ref={teamFileInputRef}
	                    type="file"
	                    multiple
	                    className="hidden"
	                    accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
	                    onChange={(event) => {
	                      if (event.target.files) addTeamFiles(event.target.files);
	                    }}
	                  />
	                  {teamMessageFiles.length > 0 || isDraggingTeamFiles ? (
	                    <div
	                      className={`mb-2 rounded-lg border border-dashed px-2 py-2 ${
	                        isDraggingTeamFiles ? "border-[#00a884] bg-[#e7f3ef]" : "border-[#d1d7db] bg-[#fbfbfa]"
	                      }`}
	                    >
	                      {teamMessageFiles.length > 0 ? (
	                        <div className="space-y-2">
	                          {teamMessageFiles.map((file) => (
	                            <PendingFileTile
	                              key={`${file.name}:${file.size}:${file.lastModified}`}
	                              file={file}
	                              onRemove={() => {
	                                setTeamMessageFiles((current) => current.filter((item) => item !== file));
	                              }}
	                            />
	                          ))}
	                        </div>
	                      ) : (
	                        <div className="py-3 text-center text-[12px] font-semibold text-[#008069]">
	                          Suelta archivos aqui
	                        </div>
	                      )}
	                    </div>
	                  ) : null}
	                  <div className="flex items-center gap-2">
	                    <button
	                      type="button"
	                      onClick={() => teamFileInputRef.current?.click()}
	                      className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#54656f] hover:bg-[#f0f2f5]"
	                      aria-label="Adjuntar archivo interno"
	                    >
	                      <Paperclip className="h-5 w-5" />
	                    </button>
	                    <input
	                      value={teamMessageInput}
	                      onChange={(event) => setTeamMessageInput(event.target.value)}
	                      placeholder="Mensaje interno"
	                      className="h-10 min-w-0 flex-1 rounded-full bg-[#f0f2f5] px-4 text-[14px] outline-none placeholder:text-[#667781]"
	                    />
	                    <button
	                      type="submit"
	                      disabled={sendTeamMessage.isPending || (!teamMessageInput.trim() && teamMessageFiles.length === 0)}
	                      className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#008069] text-white disabled:bg-[#dfe5e7] disabled:text-[#94a3aa]"
	                      aria-label="Enviar mensaje interno"
	                    >
	                      <Send className="h-4 w-4" />
	                    </button>
	                  </div>
	                </form>
	              </div>
	            )}
	          </>
	        ) : leftPanel === "labels" ? (
          <>
            <header className="flex h-[70px] shrink-0 items-center gap-4 px-5">
              <button
                type="button"
                onClick={() => setLeftPanel("chats")}
                className="grid h-10 w-10 place-items-center rounded-full hover:bg-[#f0f2f5]"
                aria-label="Volver a chats"
              >
                <X className="h-7 w-7" />
              </button>
              <h1 className="text-[22px] font-semibold leading-none tracking-normal">Etiquetas</h1>
              <Link
                href="/labels"
                className="ml-auto grid h-10 w-10 place-items-center rounded-full hover:bg-[#f0f2f5]"
                aria-label="Gestionar etiquetas"
              >
                <Plus className="h-6 w-6" />
              </Link>
            </header>
            <ScrollArea className="flex-1">
              <div className="px-4 pb-6 pt-2">
                {labels && labels.length > 0 ? (
                  labels.map((label) => {
                    const count =
                      chats?.filter((chat) => chat.labels.some((chatLabel) => chatLabel.id === label.id)).length ??
                      0;
                    return (
                      <button
                        key={label.id}
                        type="button"
                        onClick={() => {
                          setSelectedLabelId(label.id);
                          setShowArchived(false);
                          setLeftPanel("chats");
                        }}
                        className="flex w-full items-center gap-5 rounded-xl px-3 py-4 text-left hover:bg-[#f5f6f6]"
                      >
                        <span
                          className="grid h-14 w-14 shrink-0 place-items-center rounded-full text-white"
                          style={{ backgroundColor: label.color }}
                        >
                          <Folder className="h-7 w-7 fill-current" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[18px] font-semibold leading-6 text-[#111b21]">
                            {label.name}
                          </span>
                          <span className="block text-[14px] text-[#667781]">{count} chats</span>
                        </span>
                        <ChevronDown className="h-5 w-5 -rotate-90 text-[#667781]" />
                      </button>
                    );
                  })
                ) : (
                  <div className="px-6 py-12 text-center text-[15px] text-[#667781]">Sin etiquetas.</div>
                )}
              </div>
            </ScrollArea>
          </>
        ) : (
          <>
        <header className="relative flex h-[64px] shrink-0 items-center justify-between px-4">
          <h1 className="text-[24px] font-bold leading-none tracking-normal">WhatsApp</h1>
          <div className="flex items-center gap-1.5 text-[#111b21]">
            <button
              type="button"
              className="grid h-8 w-8 place-items-center rounded-full hover:bg-[#f0f2f5]"
              aria-label="Nuevo chat"
            >
              <Plus className="h-5 w-5 stroke-[2.1]" />
            </button>
            <button
              type="button"
              onClick={() => {
                setAppMenuOpen((v) => !v);
                closeMenus(setLabelMenuOpen, setChatMenuOpen, setHeaderLabelsOpen, setAttachmentMenuOpen, setEmojiOpen, setQuickReplyOpen);
              }}
              className="grid h-8 w-8 place-items-center rounded-full hover:bg-[#f0f2f5]"
              aria-label="Más opciones"
            >
              <MoreVertical className="h-5 w-5 stroke-[2.1]" />
            </button>
          </div>
          {appMenuOpen ? (
            <div className="absolute right-4 top-[52px] z-50 w-[290px] rounded-2xl border border-[#e1e4e6] bg-white py-2 shadow-[0_8px_28px_rgba(11,20,26,0.18)]">
              {appMenuItems.map((item, index) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => {
                    if (item.label === "Archivados") setShowArchived(true);
                    if (item.label === "Respuestas rápidas") setLeftPanel("quickReplies");
                    if (item.label === "Etiquetas") setLeftPanel("labels");
                    setAppMenuOpen(false);
                  }}
                  className={`flex min-h-11 w-full items-center gap-4 px-4 text-left text-[15px] text-[#111b21] hover:bg-[#f5f6f6] ${
                    index === 0 ? "rounded-xl outline outline-2 outline-[#111b21]" : ""
                  }`}
                >
                  {item.icon}
                  <span className="leading-5">{item.label}</span>
                </button>
              ))}
              <div className="my-2 h-px bg-[#eef0f2]" />
              <button
                type="button"
                className="flex min-h-11 w-full items-center gap-4 px-4 text-left text-[15px] text-[#111b21] hover:bg-[#f5f6f6]"
              >
                <Lock className={menuIconClass} />
                <span>Bloqueo de aplicación</span>
              </button>
              <button
                type="button"
                onClick={logout}
                className="flex min-h-11 w-full items-center gap-4 px-4 text-left text-[15px] text-[#111b21] hover:bg-[#f5f6f6]"
              >
                <LogOut className={menuIconClass} />
                <span>Cerrar sesión</span>
              </button>
            </div>
          ) : null}
        </header>

        <div className="px-4 pb-1.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#667781]" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar un chat o iniciar uno nuevo"
              className="h-10 w-full rounded-[20px] border-0 bg-[#eef1f3] pl-10 pr-3 text-[15px] text-[#111b21] outline-none placeholder:text-[#667781]"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 px-4 pb-1.5">
          {[
            ["all", "Todos"],
            ["unread", "No leídos"],
            ["favorites", "Favoritos"],
            ["groups", "Grupos"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setFilter(value as typeof filter);
                setShowArchived(false);
              }}
              className={`h-8 rounded-full border px-3 text-[14px] font-semibold transition-colors ${
                filter === value && !showArchived
                  ? "border-[#bfc5c8] bg-[#f5f3f1] text-[#111b21]"
                  : "border-[#d1d7db] bg-white text-[#667781] hover:bg-[#f5f6f6]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative flex items-center gap-2 px-4 pb-2.5">
          <button
            type="button"
            onClick={() => {
              setLabelMenuOpen((v) => !v);
              closeMenus(setAppMenuOpen, setChatMenuOpen, setHeaderLabelsOpen, setAttachmentMenuOpen, setEmojiOpen, setQuickReplyOpen);
            }}
            className={`flex h-8 items-center gap-2 rounded-full border border-[#cfd4d8] px-3 text-[14px] font-semibold transition-colors ${
              selectedLabel ? "bg-[#f6f5f4] text-[#111b21]" : "bg-white text-[#667781] hover:bg-[#f5f6f6]"
            }`}
          >
            {selectedLabel ? (
              <Folder className="h-5 w-5 fill-current" style={{ color: selectedLabel.color }} />
            ) : null}
            {selectedLabel?.name || "Etiquetas"}
            <ChevronDown className="h-5 w-5" />
          </button>
          {archivedCount > 0 && !showArchived ? (
            <button
              type="button"
              onClick={() => setShowArchived(true)}
            className="h-8 rounded-full border border-[#cfd4d8] bg-white px-3 text-[12px] font-semibold text-[#667781]"
            >
              Archivados {archivedCount}
            </button>
          ) : null}
          {selectedLabel ? (
            <button
              type="button"
              onClick={() => setSelectedLabelId(null)}
              className="h-8 rounded-full border border-[#cfd4d8] bg-white px-3 text-[12px] font-semibold text-[#667781] hover:bg-[#f5f6f6]"
            >
              Quitar filtro
            </button>
          ) : null}
          {labelMenuOpen ? (
            <div className="absolute left-4 top-9 z-50 w-[260px] rounded-2xl border border-[#e1e4e6] bg-white py-3 shadow-[0_8px_28px_rgba(11,20,26,0.18)]">
              <div className="max-h-[430px] overflow-y-auto px-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedLabelId(null);
                    setLabelMenuOpen(false);
                  }}
                  className={`flex h-10 w-full items-center gap-4 rounded-lg px-3 text-left text-[15px] hover:bg-[#f5f6f6] ${
                    selectedLabelId === null ? "font-semibold text-[#111b21]" : "text-[#111b21]"
                  }`}
                >
                  <span className="h-3 w-4 rounded-sm bg-[#cfd4d8]" />
                  Todas las etiquetas
                </button>
                {labels && labels.length > 0 ? (
                  labels.map((label) => (
                    <button
                      key={label.id}
                      type="button"
                      onClick={() => {
                        setSelectedLabelId(label.id);
                        setLabelMenuOpen(false);
                      }}
                      className={`flex h-10 w-full items-center gap-4 rounded-lg px-3 text-left text-[15px] hover:bg-[#f5f6f6] ${
                        selectedLabelId === label.id ? "font-semibold text-[#111b21]" : "text-[#111b21]"
                      }`}
                    >
                      <span className="h-3 w-4 rounded-sm" style={{ backgroundColor: label.color }} />
                      <span className="min-w-0 flex-1 truncate">{label.name}</span>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-4 text-sm text-[#667781]">Sin etiquetas.</div>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <ScrollArea className="flex-1">
          {isChatsLoading ? (
            <div className="space-y-1 px-2.5 py-1">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="mx-1 flex h-[56px] items-center gap-2.5 rounded-lg px-2.5">
                  <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-[#eef0f2]" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-1/2 animate-pulse rounded bg-[#eef0f2]" />
                    <div className="h-3 w-4/5 animate-pulse rounded bg-[#eef0f2]" />
                  </div>
                </div>
              ))}
            </div>
          ) : visibleChats.length === 0 ? (
            <div className="px-10 py-16 text-center text-[17px] text-[#667781]">
              {showArchived ? "No hay conversaciones archivadas." : "Sin chats."}
            </div>
          ) : (
            <div className="px-2.5 pb-4">
              {visibleChats.map((chat, index) => {
                const labelIdsOnChat = new Set(chat.labels.map((l) => l.id));
                const unreadCount = Math.max(chat.unreadCount || 0, 0);
                const badge = chat.manuallyUnread ? Math.max(unreadCount, 1) : unreadCount;
                const hasUnread = badge > 0;
                const preview = lastMessageText(chat.lastMessage) || (chat.isGroup ? "Grupo sin mensajes" : "Sin mensajes");
                const selected = activeChatId === chat.id;
                const firstLabel = chat.labels[0] ?? null;
	                const fromMe = lastMessageFromMe(chat.lastMessage);
	                const visibleName = displayChatTitle(chat);
	                const copyableCode = copyableChatCode(chat);

                return (
                  <ContextMenu key={chat.id}>
                    <ContextMenuTrigger asChild>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => selectChat(chat.id)}
                        onMouseEnter={() => prefetchChatMessages(chat.id)}
                        onFocus={() => prefetchChatMessages(chat.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            selectChat(chat.id);
                          }
                        }}
                        className={`group mx-1 grid w-[calc(100%-0.5rem)] min-w-0 max-w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 overflow-hidden rounded-md px-2.5 py-1.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884] ${
                          selected ? "bg-[#eef0f1]" : "hover:bg-[#f3f4f4]"
                        }`}
                      >
                        <AvatarBubble
                          name={displayChatName(chat)}
                          isGroup={chat.isGroup}
                          selected={selected}
                          imageSeed={index}
                          imageUrl={chat.profilePicUrl}
                          profilePicLookupUrl={chat.profilePicLookupUrl}
                          size="xs"
                        />
                        <div className="min-w-0">
                          <div className="mb-px flex items-center gap-1.5">
	                            <span className={`truncate text-[15px] leading-5 text-[#111b21] ${hasUnread ? "font-bold" : "font-semibold"}`}>
	                              {visibleName}
	                            </span>
	                            {copyableCode ? (
	                              <button
	                                type="button"
	                                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[#667781] transition hover:bg-white hover:text-[#008069] focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884] ${
	                                  selected || copiedChatCodeId === chat.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
	                                }`}
	                                title={`Copiar codigo ${copyableCode}`}
	                                aria-label={`Copiar codigo ${copyableCode}`}
	                                onMouseDown={(event) => {
	                                  event.preventDefault();
	                                  event.stopPropagation();
	                                }}
	                                onClick={(event) => {
	                                  event.preventDefault();
	                                  event.stopPropagation();
	                                  copyChatCode(chat);
	                                }}
	                              >
	                                {copiedChatCodeId === chat.id ? <Check className="h-3.5 w-3.5 text-[#008069]" /> : <Copy className="h-3.5 w-3.5" />}
	                              </button>
	                            ) : null}
	                            {firstLabel ? (
                              <Folder
                                className="h-3.5 w-3.5 shrink-0 fill-current"
                                style={{ color: labelColor(firstLabel) }}
                              />
                            ) : null}
                            {chat.favorited ? (
                              <Star className="h-3.5 w-3.5 shrink-0 fill-[#f5bd31] text-[#f5bd31]" />
                            ) : null}
                            {chat.muted ? (
                              <VolumeX className="h-3.5 w-3.5 shrink-0 text-[#667781]" />
                            ) : null}
                          </div>
                          <div className={`flex min-w-0 items-center gap-1 text-[12px] leading-4 ${hasUnread ? "font-semibold text-[#111b21]" : "text-[#667781]"}`}>
                            {chat.pinned ? <Pin className="h-3.5 w-3.5 shrink-0" /> : null}
                            {fromMe ? <CheckCheck className="h-3.5 w-3.5 shrink-0 text-[#667781]" /> : null}
                            <span className="truncate">{preview}</span>
                          </div>
                        </div>
                        <div className="flex w-[64px] shrink-0 flex-col items-end gap-0.5 self-stretch py-px">
                          <span className={`whitespace-nowrap text-[12px] font-semibold leading-4 ${hasUnread ? "text-[#1fa855]" : "text-[#667781]"}`}>
                            {formatChatTime(chat.timestamp)}
                          </span>
                          <div className="flex min-h-5 items-center gap-1">
                            {badge > 0 ? (
                              <span
                                className="grid h-6 min-w-6 place-items-center rounded-full bg-[#1fa855] px-1.5 text-[12px] font-bold leading-none text-white shadow-sm"
                                title={`${badge} ${badge === 1 ? "mensaje sin leer" : "mensajes sin leer"}`}
                                aria-label={`${badge} ${badge === 1 ? "mensaje sin leer" : "mensajes sin leer"}`}
                              >
                                {badge > 99 ? "99+" : badge}
                              </span>
                            ) : null}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  className="grid h-6 w-6 place-items-center rounded-full text-[#667781] opacity-0 transition-opacity hover:bg-[#e9edef] hover:text-[#111b21] focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884] group-hover:opacity-100 data-[state=open]:opacity-100"
                                  aria-label={`Acciones de ${visibleName}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    closeMenus(
                                      setLabelMenuOpen,
                                      setAppMenuOpen,
                                      setChatMenuOpen,
                                      setHeaderLabelsOpen,
                                      setAttachmentMenuOpen,
                                      setEmojiOpen,
                                      setQuickReplyOpen,
                                    );
                                  }}
                                  onKeyDown={(event) => event.stopPropagation()}
                                >
                                  <ChevronDown className="h-4 w-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" sideOffset={6} className="w-64">
                                {renderChatRowMenuItems(chat, labelIdsOnChat, {
                                  Item: DropdownMenuItem,
                                  Separator: DropdownMenuSeparator,
                                  Sub: DropdownMenuSub,
                                  SubTrigger: DropdownMenuSubTrigger,
                                  SubContent: DropdownMenuSubContent,
                                })}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                          {chat.assignedTo ? (
                            <span
                              className="max-w-[64px] truncate rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none text-white"
                              style={{ backgroundColor: chat.assignedTo.color || COLLABORATOR_COLOR_OPTIONS[0] }}
                              title={`Derivado a ${chat.assignedTo.displayName}`}
                            >
                              {chat.assignedTo.displayName}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-64">
                      {renderChatRowMenuItems(chat, labelIdsOnChat, {
                        Item: ContextMenuItem,
                        Separator: ContextMenuSeparator,
                        Sub: ContextMenuSub,
                        SubTrigger: ContextMenuSubTrigger,
                        SubContent: ContextMenuSubContent,
                      })}
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
            </div>
          )}
        </ScrollArea>
          </>
        )}
      </section>

      <main
        className="wa-chat-bg relative flex min-w-0 flex-1 flex-col bg-[#efeae2]"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDraggingFiles && activeChatId ? (
          <div className="pointer-events-none absolute inset-5 z-[60] grid place-items-center rounded-2xl border-2 border-dashed border-[#00a884] bg-white/75 text-[18px] font-semibold text-[#008069] shadow-sm backdrop-blur-sm">
            Suelta archivos para enviar
          </div>
        ) : null}
        {!activeChatId ? (
          <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-8 text-center">
            <div className="mb-6 grid h-20 w-20 place-items-center rounded-2xl border border-[#dce3df] bg-white/75 text-[#008069] shadow-sm">
              <MessageCircle className="h-10 w-10 stroke-[1.7]" />
            </div>
            <h2 className="mb-2 text-[26px] font-semibold leading-tight text-[#263238]">Selecciona un chat</h2>
            <p className="max-w-[360px] text-[15px] leading-6 text-[#667781]">
              Los mensajes y acciones del CRM aparecerán en este espacio.
            </p>
            {showDeviceSyncNotice ? (
              <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-[#d9f2e6] bg-white/85 px-4 py-2 text-[13px] font-semibold text-[#008069] shadow-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                {deviceSyncText}
              </div>
            ) : null}
          </div>
        ) : (
          <>
	            <header className="relative z-[120] flex h-[70px] shrink-0 items-center border-b border-[#e4e7e8] bg-white px-5">
	              <div
	                role="button"
	                tabIndex={0}
	                aria-label="Abrir informacion del contacto"
	                onClick={() => {
	                  setDetailsPanelOpen(true);
	                  setMediaPanelOpen(false);
	                  setPendingPanelOpen(false);
	                  closeMenus(setChatMenuOpen, setHeaderLabelsOpen, setAttachmentMenuOpen, setEmojiOpen, setQuickReplyOpen);
	                }}
	                onKeyDown={(event) => {
	                  if (event.key === "Enter" || event.key === " ") {
	                    event.preventDefault();
	                    setDetailsPanelOpen(true);
	                    setMediaPanelOpen(false);
	                    setPendingPanelOpen(false);
	                    closeMenus(setChatMenuOpen, setHeaderLabelsOpen, setAttachmentMenuOpen, setEmojiOpen, setQuickReplyOpen);
	                  }
	                }}
	                className="group/header flex min-w-0 flex-1 cursor-pointer items-center rounded-xl py-1 pr-3 text-left hover:bg-[#f7f8f8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]"
	              >
	                <AvatarBubble
	                  name={activeChatFullName || activeChatName}
                  isGroup={activeChat?.isGroup}
                  imageUrl={activeChat?.profilePicUrl}
                  profilePicLookupUrl={activeChat?.profilePicLookupUrl}
                />
	                <div className="ml-4 flex min-w-0 flex-1 items-center gap-2">
	                  <h2 className="truncate text-[20px] font-semibold leading-6 text-[#111b21]">
	                    {activeChatName}
	                  </h2>
	                  {activeChat && activeChatCopyCode ? (
	                    <button
	                      type="button"
	                      className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[#667781] transition hover:bg-[#e9edef] hover:text-[#008069] focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884] ${
	                        copiedChatCodeId === activeChat.id ? "opacity-100" : "opacity-0 group-hover/header:opacity-100"
	                      }`}
	                      title={`Copiar codigo ${activeChatCopyCode}`}
	                      aria-label={`Copiar codigo ${activeChatCopyCode}`}
	                      onMouseDown={(event) => {
	                        event.preventDefault();
	                        event.stopPropagation();
	                      }}
	                      onClick={(event) => {
	                        event.preventDefault();
	                        event.stopPropagation();
	                        copyChatCode(activeChat);
	                      }}
	                    >
	                      {copiedChatCodeId === activeChat.id ? <Check className="h-4 w-4 text-[#008069]" /> : <Copy className="h-4 w-4" />}
	                    </button>
	                  ) : null}
	                  {activeChat?.muted ? (
	                    <VolumeX className="h-4 w-4 shrink-0 text-[#667781]" aria-label="Notificaciones silenciadas" />
	                  ) : null}
	                </div>
	              </div>
              <div className="flex items-center gap-3 text-[#111b21]">
                <button
                  type="button"
                  onClick={() => {
                    if (!currentPermissions.canManageLabels) {
                      toast.error("No tienes permiso para etiquetar chats");
                      return;
                    }
                    setHeaderLabelsOpen((v) => !v);
                    closeMenus(setLabelMenuOpen, setAppMenuOpen, setChatMenuOpen, setAttachmentMenuOpen, setEmojiOpen, setQuickReplyOpen);
                  }}
                  className="flex h-10 max-w-[240px] items-center gap-2 rounded-full border border-[#d1d7db] bg-white px-4 hover:bg-[#f5f6f6]"
                  aria-disabled={!currentPermissions.canManageLabels}
                >
                  {headerLabel ? (
                    <>
                    <Folder className="h-5 w-5 shrink-0 fill-current" style={{ color: headerLabel.color }} />
                    <span className="truncate text-[15px] font-semibold">{headerLabel.name}</span>
                    </>
                  ) : (
                    <>
                      <Tag className="h-5 w-5 shrink-0 text-[#111b21]" />
                      <span className="truncate text-[15px] font-semibold">Etiquetar chat</span>
                    </>
                  )}
                  <ChevronDown className="h-4 w-4 shrink-0" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPendingPanelOpen(true);
                    setDetailsPanelOpen(false);
                    setMediaPanelOpen(false);
                    closeMenus(setLabelMenuOpen, setAppMenuOpen, setChatMenuOpen, setHeaderLabelsOpen, setAttachmentMenuOpen, setEmojiOpen, setQuickReplyOpen);
                  }}
                  className={`flex h-10 items-center gap-2 rounded-full border border-[#d1d7db] bg-white px-4 hover:bg-[#f5f6f6] ${
                    pendingPanelOpen ? "bg-[#e7f3ef] text-[#008069]" : ""
                  }`}
                >
                  <Pin className="h-4 w-4" />
                  <span className="text-[15px] font-semibold">Pendientes</span>
                  {pendingAssignedChats.length > 0 ? (
                    <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#d93025] px-1.5 text-[11px] font-bold leading-none text-white">
                      {pendingAssignedChats.length > 99 ? "99+" : pendingAssignedChats.length}
                    </span>
                  ) : null}
                </button>
	                <button
	                  type="button"
	                  onClick={openChatSearch}
	                  className={`grid h-10 w-10 place-items-center rounded-full hover:bg-[#f0f2f5] ${
	                    chatSearchOpen ? "bg-[#e7f3ef] text-[#008069]" : ""
	                  }`}
	                  aria-label="Buscar en este chat"
	                >
	                  <Search className="h-6 w-6" />
	                </button>
                <button
                  type="button"
                  onClick={() => {
                    setChatMenuOpen((v) => !v);
                    closeMenus(setLabelMenuOpen, setAppMenuOpen, setHeaderLabelsOpen, setAttachmentMenuOpen, setEmojiOpen, setQuickReplyOpen);
                  }}
                  className="grid h-10 w-10 place-items-center rounded-full hover:bg-[#f0f2f5]"
                  aria-label="Más"
                >
                  <MoreVertical className="h-6 w-6" />
                </button>
              </div>
              {headerLabelsOpen ? (
                <>
                <button
                  type="button"
                  aria-label="Cerrar etiquetas"
                  className="fixed inset-0 z-[110] cursor-default bg-transparent"
                  onClick={() => setHeaderLabelsOpen(false)}
                />
                <div className="absolute right-[260px] top-[56px] z-[130] w-[305px] rounded-2xl border border-[#e1e4e6] bg-white py-3 shadow-[0_8px_28px_rgba(11,20,26,0.18)]">
                  <div className="max-h-[380px] overflow-y-auto px-3">
                    {!currentPermissions.canManageLabels ? (
                      <div className="px-3 py-4 text-sm text-[#667781]">
                        No tienes permiso para etiquetar chats.
                      </div>
                    ) : labels && labels.length > 0 ? (
                      labels.map((label) => {
                        const attached = activeChat?.labels?.some((chatLabel) => chatLabel.id === label.id) ?? false;
                        return (
                          <button
                            key={label.id}
                            type="button"
                            disabled={toggleLabelOnChat.isPending}
                            onClick={() => {
                              if (activeChat) {
                                toggleLabelOnChat.mutate({ chat: activeChat, labelId: label.id, attached });
                              } else {
                                setSelectedLabelId(label.id);
                              }
                            }}
                            className="flex h-[52px] w-full items-center gap-4 rounded-lg px-2 text-left text-[16px] text-[#111b21] hover:bg-[#f5f6f6]"
                          >
                            <span className="h-4 w-5 rounded-sm" style={{ backgroundColor: label.color }} />
                            <span className="min-w-0 flex-1 truncate">{label.name}</span>
                            <span
                              className={`grid h-5 w-5 place-items-center rounded border ${
                                attached ? "border-[#111b21] bg-[#111b21] text-white" : "border-[#9aa3a9] bg-white"
                              }`}
                            >
                              {attached ? <Check className="h-3.5 w-3.5" /> : null}
                            </span>
                          </button>
                        );
                      })
                    ) : (
                      <div className="px-3 py-4">
                        <div className="text-sm text-[#667781]">Aún no tienes etiquetas creadas.</div>
                        <button
                          type="button"
                          onClick={() => {
                            setHeaderLabelsOpen(false);
                            setLocation("/labels");
                          }}
                          className="mt-3 rounded-full bg-[#008069] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#006d5b]"
                        >
                          Crear etiqueta
                        </button>
                      </div>
                    )}
                    {currentPermissions.canManageLabels && labels && labels.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setHeaderLabelsOpen(false);
                          setLocation("/labels");
                        }}
                        className="mt-2 flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[14px] font-semibold text-[#008069] hover:bg-[#f5f6f6]"
                      >
                        <Tags className="h-4 w-4" />
                        Gestionar etiquetas
                      </button>
                    ) : null}
                  </div>
                </div>
                </>
              ) : null}
              {chatMenuOpen ? (
                <>
                  <button
                    type="button"
                    aria-label="Cerrar menú"
                    className="fixed inset-0 z-[110] cursor-default bg-transparent"
                    onClick={() => {
                      setChatMenuOpen(false);
                    }}
                  />
                <div className="absolute right-3 top-[58px] z-[130] w-[292px] overflow-visible rounded-xl border border-[#e8ecef] bg-white py-1.5 shadow-[0_12px_32px_rgba(11,20,26,0.14)]">
                  {chatMenuItems.map((item) =>
                    item.key === "assign" ? (
                      <div key={item.key} className="border-y border-[#eef0f2] py-1">
                        <div className="flex min-h-10 w-full items-center gap-3 px-4 text-left text-[14px] font-medium text-[#111b21]">
                          {item.icon}
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        </div>
                        <div className="max-h-56 overflow-y-auto px-2 pb-1">
                          {assignableCollaborators.length > 0 && activeChat ? (
                            assignableCollaborators.map((collaborator) => {
                              const selected = activeChat.assignedTo?.userId === collaborator.id;
                              return (
                                <button
                                  key={collaborator.id}
                                  type="button"
                                  disabled={!currentPermissions.canManageChats || assignChat.isPending}
                                  onClick={() => assignChat.mutate({ chat: activeChat, collaborator })}
                                  className={`flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] font-medium text-[#111b21] hover:bg-[#f7f8f8] disabled:cursor-not-allowed disabled:opacity-50 ${
                                    selected ? "bg-[#e7f3ef]" : ""
                                  }`}
                                >
                                  <span
                                    className="h-3 w-3 shrink-0 rounded-full"
                                    style={{ backgroundColor: collaborator.labelColor || COLLABORATOR_COLOR_OPTIONS[0] }}
                                  />
                                  <span className="min-w-0 flex-1 truncate">{collaborator.displayName}</span>
                                  {selected ? <Check className="h-4 w-4 shrink-0 text-[#008069]" /> : null}
                                </button>
                              );
                            })
                          ) : (
                            <div className="px-3 py-3 text-[13px] text-[#667781]">Sin colaboradores disponibles.</div>
                          )}
                          {activeChat?.assignedTo ? (
                            <button
                              type="button"
                              disabled={!currentPermissions.canManageChats || assignChat.isPending}
                              onClick={() => assignChat.mutate({ chat: activeChat, collaborator: null })}
                              className="mt-1 flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] font-medium text-[#b42318] hover:bg-[#fff4f4] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <X className="h-4 w-4" />
                              <span>Quitar derivación</span>
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => handleChatMenuAction(item.key)}
                        className="flex min-h-10 w-full items-center gap-3 px-4 text-left text-[14px] font-medium text-[#111b21] hover:bg-[#f7f8f8]"
                      >
                        {item.icon}
                        <span>{item.label}</span>
                      </button>
                    ),
                  )}
                  <div className="my-1 h-px bg-[#eef0f2]" />
                  {[
                    { label: "Reportar", icon: <Flag className={menuIconClass} /> },
                    { label: "Bloquear", icon: <Ban className={menuIconClass} /> },
                    { label: "Vaciar chat", icon: <Eraser className={menuIconClass} /> },
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => {
                        setChatMenuOpen(false);
                        toast.info(`${item.label} disponible desde WhatsApp.`);
                      }}
                      className="flex min-h-10 w-full items-center gap-3 px-4 text-left text-[14px] font-medium text-[#111b21] hover:bg-[#f7f8f8]"
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
                </>
	              ) : null}
	            </header>

            {showDeviceSyncNotice ? (
              <div className="relative z-10 flex h-9 shrink-0 items-center justify-center border-b border-[#d9f2e6] bg-[#f0fbf6] text-[13px] font-semibold text-[#008069]">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {deviceSyncText}
              </div>
            ) : null}

		            {chatSearchOpen ? (
	              <div className="relative z-10 border-b border-[#e4e7e8] bg-white px-5 py-2.5">
	                <div className="mx-auto flex w-full max-w-[940px] items-center gap-2">
	                  <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-[#f0f2f5] px-3">
	                    <Search className="h-4 w-4 shrink-0 text-[#667781]" />
	                    <input
	                      ref={chatSearchInputRef}
	                      value={chatSearchQuery}
	                      onChange={(event) => setChatSearchQuery(event.target.value)}
	                      onKeyDown={(event) => {
	                        if (event.key === "Escape") {
	                          closeChatSearch();
	                          return;
	                        }
	                        if (event.key === "Enter") {
	                          event.preventDefault();
	                          moveChatSearch(event.shiftKey ? -1 : 1);
	                        }
	                      }}
	                      className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-[#111b21] outline-none placeholder:text-[#667781]"
	                      placeholder="Buscar palabras en este chat"
	                      aria-label="Buscar palabras en este chat"
	                    />
	                  </label>
	                  <span className="min-w-[88px] text-right text-[12px] font-semibold text-[#667781]">
	                    {normalizedChatSearchQuery
	                      ? chatSearchMatches.length > 0
	                        ? `${activeSearchMatchIndex + 1} de ${chatSearchMatches.length}`
	                        : "Sin resultados"
	                      : "Escribe..."}
	                  </span>
	                  <button
	                    type="button"
	                    onClick={() => moveChatSearch(-1)}
	                    disabled={!chatSearchMatches.length}
	                    className="grid h-9 w-9 place-items-center rounded-full text-[#54656f] hover:bg-[#f0f2f5] disabled:cursor-not-allowed disabled:opacity-35"
	                    aria-label="Resultado anterior"
	                  >
	                    <ChevronDown className="h-5 w-5 rotate-180" />
	                  </button>
	                  <button
	                    type="button"
	                    onClick={() => moveChatSearch(1)}
	                    disabled={!chatSearchMatches.length}
	                    className="grid h-9 w-9 place-items-center rounded-full text-[#54656f] hover:bg-[#f0f2f5] disabled:cursor-not-allowed disabled:opacity-35"
	                    aria-label="Resultado siguiente"
	                  >
	                    <ChevronDown className="h-5 w-5" />
	                  </button>
	                  <button
	                    type="button"
	                    onClick={closeChatSearch}
	                    className="grid h-9 w-9 place-items-center rounded-full text-[#54656f] hover:bg-[#f0f2f5]"
	                    aria-label="Cerrar búsqueda"
	                  >
	                    <X className="h-5 w-5" />
	                  </button>
	                </div>
	              </div>
	            ) : null}

	            <ScrollArea className="relative z-10 flex-1">
              <div className="mx-auto flex w-full max-w-[940px] flex-col gap-1.5 px-8 py-6">
                <div className="my-2 self-center rounded-lg bg-white px-4 py-1.5 text-[13px] font-semibold text-[#667781] shadow-sm">
                  Hoy
                </div>
	                {isMessagesError ? (
		                  <div className="self-center rounded-lg border border-[#f0d3a1] bg-[#fff8e8] px-4 py-3 text-sm text-[#7a4d00] shadow-sm">
		                    No se pudieron cargar los mensajes. {(messagesError as Error)?.message || ""}
		                  </div>
		                ) : activeMessages.length === 0 ? (
	                  <div className="self-center rounded-lg bg-[#fff5c4] px-4 py-3 text-sm text-[#5f5500] shadow-sm">
	                    {showMessagesSyncing ? "Sin mensajes guardados, sincronizando..." : "Envía un mensaje para iniciar."}
                  </div>
                ) : (
		                  activeMessages.map((msg) => {
	                    const encodedBody = looksLikeEncodedMedia(msg.body || "");
	                    const showMediaCard = msg.hasMedia || encodedBody;
	                    const legacyReply = encodedBody ? null : splitLegacyReplyBody(msg.body || "");
	                    const body = encodedBody ? "" : visibleMessageBody(msg.body || "");
	                    const mediaName = fileNameFromMessage(msg);
	                    const isImageMedia =
	                      msg.type === "image" || msg.mediaMimeType?.startsWith("image/") || encodedBody;
                    const isVideoMedia = isVideoMessage(msg);
                    const imageSrc =
                      isImageMedia && msg.mediaUrl
                        ? msg.mediaUrl
                        : encodedBody && msg.body.startsWith("data:image/")
                          ? msg.body
                          : null;
	                    const videoSrc = isVideoMedia && msg.mediaUrl ? msg.mediaUrl : null;
	                    const audioSrc = msg.mediaMimeType?.startsWith("audio/") && msg.mediaUrl ? msg.mediaUrl : null;
	                    const visualOnly = !!(imageSrc || videoSrc) && !body;
	                    const visualMedia = !!(imageSrc || videoSrc);
	                    const messageTime = formatMessageTime(msg.timestamp);
	                    const authorCode = (msg.author ? participantDigitsById.get(msg.author) : "") || trustedDigitsFromWaId(msg.author);
			                    const messageReaction = messageReactions[msg.id];
			                    const messagePinned = messagePinOverrides[msg.id] ?? pinnedMessageIds.includes(msg.id);
			                    const messageStarred = messageStarOverrides[msg.id] ?? msg.isStarred ?? starredMessageIds.includes(msg.id);
			                    const isSearchMatch = chatSearchOpen && chatSearchMatchIds.has(msg.id);
			                    const isActiveSearchMatch = activeSearchMessageId === msg.id;
			                    const quotedParticipantDigits =
		                      (msg.quotedParticipant ? participantDigitsById.get(msg.quotedParticipant) : "") ||
		                      trustedDigitsFromWaId(msg.quotedParticipant);
		                    const messageQuote =
		                      messageQuotePreviews[msg.id] ??
		                      (msg.quotedBody
		                        ? {
		                            body: sanitizePreview(msg.quotedBody),
		                            authorLabel: msg.quotedFromMe
		                              ? "Tú"
		                              : quotedParticipantDigits
		                                ? formatSixDigitCode(quotedParticipantDigits)
		                                : activeChatName || "Contacto",
		                            fromMe: msg.quotedFromMe,
		                          }
		                        : legacyReply
		                          ? {
		                              body: sanitizePreview(legacyReply.quotedBody),
		                              authorLabel: msg.fromMe ? activeChatName || "Contacto" : "Tú",
		                              fromMe: !msg.fromMe,
		                            }
		                          : null);

	                    return (
		                      <div
		                        key={msg.id}
		                        ref={(node) => {
		                          if (node) {
		                            messageSearchRefs.current[msg.id] = node;
		                          } else {
		                            delete messageSearchRefs.current[msg.id];
		                          }
		                        }}
		                        className={`group/message relative flex max-w-[74%] flex-col rounded-xl transition ${
		                          msg.fromMe ? "self-end items-end" : "self-start items-start"
		                        } ${
		                          isActiveSearchMatch
		                            ? "ring-2 ring-[#f5c542] ring-offset-4 ring-offset-transparent"
		                            : isSearchMatch
		                              ? "ring-1 ring-[#f5c542]/70 ring-offset-2 ring-offset-transparent"
		                              : ""
		                        }`}
		                      >
		                        <button
		                          type="button"
		                          onClick={() => setOpenMessageMenuId((current) => (current === msg.id ? null : msg.id))}
	                          className={`absolute top-1 z-30 grid h-6 w-6 place-items-center rounded-full bg-white/85 text-[#54656f] opacity-0 shadow-sm transition-opacity hover:bg-white group-hover/message:opacity-100 ${
		                            "right-1"
		                          } ${openMessageMenuId === msg.id ? "opacity-100" : ""}`}
		                          aria-label="Acciones del mensaje"
		                        >
	                          <ChevronDown className="h-4 w-4" />
	                        </button>
	                        {openMessageMenuId === msg.id ? (
	                          <>
	                            <button
	                              type="button"
	                              aria-label="Cerrar acciones"
	                              className="fixed inset-0 z-40 cursor-default bg-transparent"
	                              onClick={() => setOpenMessageMenuId(null)}
	                            />
			                            <div
			                              className={`absolute top-8 z-50 w-[245px] overflow-hidden rounded-xl border border-[#e8ecef] bg-white shadow-[0_14px_38px_rgba(11,20,26,0.18)] ${
			                                msg.fromMe ? "right-0" : "left-0"
			                              }`}
			                            >
	                              <div className="flex items-center gap-1 border-b border-[#eef0f2] px-2 py-1.5">
	                                {["👍", "❤️", "😂", "😮", "😢", "🙏"].map((reaction) => (
	                                  <button
	                                    key={reaction}
	                                    type="button"
	                                    onClick={() => addReactionToMessage(msg, reaction)}
	                                    className="grid h-8 w-8 place-items-center rounded-full text-[17px] hover:bg-[#f5f6f6]"
	                                    aria-label={`Reaccionar ${reaction}`}
	                                  >
	                                    {reaction}
	                                  </button>
	                                ))}
	                                <button
	                                  type="button"
	                                  onClick={() => toast.info("Selecciona una reacción rápida.")}
	                                  className="ml-auto grid h-8 w-8 place-items-center rounded-full hover:bg-[#f5f6f6]"
	                                  aria-label="Más reacciones"
	                                >
	                                  <Plus className="h-4 w-4" />
	                                </button>
	                              </div>
	                              {[
	                                {
	                                  key: "info",
	                                  label: "Info. del mensaje",
	                                  icon: <Info className="h-4 w-4" />,
	                                  onClick: () => messageInfoMutation.mutate(msg),
	                                },
	                                {
	                                  key: "reply",
	                                  label: "Responder",
		                                  icon: <CornerUpLeft className="h-4 w-4" />,
		                                  onClick: () => {
		                                    setReplyToMessage(msg);
		                                    setOpenMessageMenuId(null);
		                                    window.setTimeout(() => messageTextareaRef.current?.focus(), 0);
		                                  },
		                                },
	                                {
	                                  key: "copy",
	                                  label: "Copiar",
	                                  icon: <Copy className="h-4 w-4" />,
	                                  onClick: () => copyMessageText(msg),
	                                },
		                                {
		                                  key: "react",
		                                  label: "Reaccionar",
		                                  icon: <Smile className="h-4 w-4" />,
		                                  onClick: () => addReactionToMessage(msg, "👍"),
		                                },
		                                ...(msg.hasMedia || msg.mediaUrl || msg.body?.startsWith("data:")
		                                  ? [
		                                      {
		                                        key: "download",
		                                        label: "Descargar",
		                                        icon: <Download className="h-4 w-4" />,
		                                        onClick: () => downloadMessageMedia(msg),
		                                      },
		                                    ]
		                                  : []),
		                                {
		                                  key: "forward",
		                                  label: "Reenviar",
	                                  icon: <Forward className="h-4 w-4" />,
	                                  onClick: () => startForwardMessage(msg),
	                                },
	                                {
	                                  key: "pin",
	                                  label: messagePinned ? "Desfijar" : "Fijar",
	                                  icon: <Pin className="h-4 w-4" />,
	                                  onClick: () => {
	                                    if (!currentPermissions.canManageChats) {
	                                      toast.error("No tienes permiso para fijar mensajes");
	                                      return;
	                                    }
	                                    pinMessageMutation.mutate({ msg, pinned: !messagePinned });
	                                  },
	                                },
	                                {
	                                  key: "star",
	                                  label: messageStarred ? "Quitar destacado" : "Destacar",
	                                  icon: <Star className="h-4 w-4" />,
	                                  onClick: () => {
	                                    if (!currentPermissions.canManageChats) {
	                                      toast.error("No tienes permiso para destacar mensajes");
	                                      return;
	                                    }
	                                    starMessageMutation.mutate({ msg, starred: !messageStarred });
	                                  },
	                                },
	                                {
	                                  key: "note",
	                                  label: "Añadir texto a la nota",
	                                  icon: <Plus className="h-4 w-4" />,
	                                  onClick: () => {
	                                    addMessageToNote.mutate(msg);
	                                    setOpenMessageMenuId(null);
	                                  },
	                                },
	                                {
	                                  key: "delete",
	                                  label: "Eliminar",
	                                  icon: <Trash2 className="h-4 w-4" />,
	                                  onClick: () => deleteMessageLocally(msg),
	                                  danger: true,
	                                },
	                              ].map((item) => (
		                                <button
		                                  key={item.key}
		                                  type="button"
		                                  onClick={item.onClick}
		                                  className={`flex min-h-10 w-full items-center gap-3 px-4 text-left text-[14px] font-medium hover:bg-[#f7f8f8] ${
		                                    "danger" in item && item.danger ? "text-[#b42318]" : "text-[#111b21]"
		                                  }`}
		                                >
		                                  {item.icon}
		                                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
		                                </button>
	                              ))}
	                            </div>
	                          </>
	                        ) : null}
	                        <div
	                          className={
                            visualOnly
                              ? "relative overflow-hidden rounded-lg shadow-sm"
                              : `wa-bubble rounded-xl text-[15px] leading-6 shadow-sm ${
                                  msg.fromMe
                                    ? "wa-bubble-out rounded-tr-sm bg-[#d9fdd3]"
                                    : "wa-bubble-in rounded-tl-sm bg-white"
                                } ${visualMedia ? "p-1.5" : "px-3 py-2"}`
                          }
                        >
	                          {!visualOnly && !msg.fromMe && activeChat?.isGroup && authorCode ? (
	                            <div className="mb-1 text-[14px] font-bold text-[#00a884]">
	                              {formatSixDigitCode(authorCode)}
	                            </div>
	                          ) : null}
	                          {!visualOnly && messageQuote ? (
	                            <div
	                              className={`mb-1.5 w-full min-w-[190px] max-w-[360px] rounded-lg border-l-4 px-2.5 py-1.5 ${
	                                msg.fromMe
	                                  ? "border-l-[#d94d32] bg-[#c8efc1]"
	                                  : "border-l-[#008069] bg-[#f0f2f5]"
	                              }`}
	                            >
	                              <div
	                                className={`truncate text-[13px] font-semibold leading-5 ${
	                                  messageQuote.fromMe ? "text-[#008069]" : "text-[#d94d32]"
	                                }`}
	                              >
	                                {messageQuote.authorLabel}
	                              </div>
	                              <div className="truncate text-[13px] leading-5 text-[#3b4a54]">
	                                {messageQuote.body}
	                              </div>
	                            </div>
	                          ) : null}
	                          {showMediaCard ? (
	                            videoSrc ? (
                              <VideoPreview
                                src={videoSrc}
                                time={visualOnly ? messageTime : undefined}
                                fromMe={visualOnly ? msg.fromMe : false}
                              />
                            ) : imageSrc ? (
                              <button
                                type="button"
                                onClick={() => setImagePreview({ src: imageSrc, alt: mediaName })}
                                className={`relative block cursor-zoom-in overflow-hidden text-left ${
                                  visualOnly ? "rounded-lg" : "rounded-lg bg-black/5"
                                }`}
                                aria-label="Abrir imagen"
                              >
                                <img
                                  src={imageSrc}
                                  alt={mediaName}
                                  className="max-h-[460px] w-full max-w-[430px] object-cover"
                                />
                                {visualOnly ? (
                                  <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-full bg-black/45 px-1.5 py-0.5 text-[10px] leading-none text-white">
                                    {messageTime}
                                    {msg.fromMe ? <CheckCheck className="h-3 w-3" /> : null}
                                  </span>
                                ) : null}
                              </button>
	                            ) : audioSrc ? (
	                              <div className="mb-2">
	                                <AudioPreview src={audioSrc} name={mediaName} />
	                              </div>
	                            ) : (
	                              <div className="mb-2">
	                                <DocumentPreview
                                  name={mediaName}
                                  mimeType={msg.mediaMimeType}
                                  href={msg.mediaUrl}
                                />
                              </div>
                            )
                          ) : null}
                          {!visualOnly && body ? (
                            <LinkifiedText
                              text={body}
                              className={`whitespace-pre-wrap break-words ${visualMedia ? "px-1.5 pb-0.5 pt-1 text-[17px]" : ""}`}
                            />
                          ) : null}
                          {!visualOnly ? (
                            <div
                              className={`mt-1 flex items-center justify-end gap-1 text-[10px] leading-none ${
                                msg.fromMe ? "text-[#4d6f4a]" : "text-[#667781]"
                              }`}
                            >
	                              <span>{messageTime}</span>
	                              {msg.fromMe ? <CheckCheck className="h-3.5 w-3.5" /> : null}
	                            </div>
	                          ) : null}
	                        </div>
	                        {messageReaction || messagePinned || messageStarred ? (
	                          <div
	                            className={`mt-0.5 flex max-w-full items-center gap-1 text-[11px] leading-none ${
	                              msg.fromMe ? "self-end" : "self-start"
	                            }`}
	                          >
	                            {messageReaction ? (
	                              <span className="rounded-full bg-white px-1.5 py-0.5 shadow-sm">
	                                {messageReaction}
	                              </span>
	                            ) : null}
	                            {messagePinned ? (
	                              <span className="flex items-center gap-1 rounded-full bg-white px-1.5 py-0.5 font-semibold text-[#54656f] shadow-sm">
	                                <Pin className="h-3 w-3" />
	                                Fijado
	                              </span>
	                            ) : null}
	                            {messageStarred ? (
	                              <span className="flex items-center gap-1 rounded-full bg-white px-1.5 py-0.5 font-semibold text-[#54656f] shadow-sm">
	                                <Star className="h-3 w-3" />
	                                Destacado
	                              </span>
	                            ) : null}
	                          </div>
	                        ) : null}
	                      </div>
	                    );
	                  })
	                )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            <footer className="relative z-10 shrink-0 bg-transparent px-5 py-4">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
                onChange={(event) => {
                  if (event.currentTarget.files) addPendingFiles(event.currentTarget.files);
                  event.currentTarget.value = "";
                }}
              />
              <input
                ref={mediaInputRef}
                type="file"
                multiple
                className="hidden"
                accept="image/*,video/*"
                onChange={(event) => {
                  if (event.currentTarget.files) addPendingFiles(event.currentTarget.files);
                  event.currentTarget.value = "";
                }}
              />
              {attachmentMenuOpen ? (
                <div className="absolute bottom-[96px] left-6 z-50 w-[285px] rounded-2xl border border-[#e1e4e6] bg-white py-2 shadow-[0_8px_28px_rgba(11,20,26,0.18)]">
                  {attachmentItems.map((item, index) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => {
                        if (item.action === "document") {
                          if (!currentPermissions.canSendMedia) {
                            toast.error("No tienes permiso para enviar archivos");
                            setAttachmentMenuOpen(false);
                            return;
                          }
                          fileInputRef.current?.click();
                        } else if (item.action === "media") {
                          if (!currentPermissions.canSendMedia) {
                            toast.error("No tienes permiso para enviar archivos");
                            setAttachmentMenuOpen(false);
                            return;
                          }
                          mediaInputRef.current?.click();
                        } else if (item.quickReply) {
                          if (!currentPermissions.canUseQuickReplies) {
                            toast.error("No tienes permiso para usar respuestas rápidas");
                            setAttachmentMenuOpen(false);
                            return;
	                          }
	                          setQuickReplyHighlightIndex(0);
	                          setQuickReplyOpen(true);
	                        } else {
                          toast.info(`${item.label}: usa respuestas rápidas para enviar adjuntos guardados.`);
                        }
                        setAttachmentMenuOpen(false);
                      }}
                      className={`flex min-h-12 w-full items-center gap-5 px-5 text-left text-[17px] text-[#111b21] hover:bg-[#f5f6f6] ${
                        index === 0 ? "rounded-xl outline outline-2 outline-[#111b21]" : ""
                      } ${index === 8 ? "mt-2 border-t border-[#eef0f2]" : ""}`}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {emojiOpen ? (
                <div className="absolute bottom-[96px] left-[96px] z-50 w-[760px] max-w-[calc(100vw-140px)] rounded-2xl border border-[#e1e4e6] bg-white shadow-[0_8px_28px_rgba(11,20,26,0.18)]">
                  <div className="flex h-16 items-center justify-around border-b border-[#eef0f2] px-5 text-[#667781]">
                    <Smile className="h-7 w-7 text-[#111b21]" />
                    <MessageCircle className="h-7 w-7" />
                    <Tags className="h-7 w-7" />
                    <Package className="h-7 w-7" />
                    <CircleDashed className="h-7 w-7" />
                    <Video className="h-7 w-7" />
                    <Zap className="h-7 w-7" />
                    <Flag className="h-7 w-7" />
                  </div>
                  <div className="p-5">
                    <div className="relative mb-5">
                      <Search className="pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-[#667781]" />
                      <input
                        aria-label="Buscar emoji"
                        placeholder="Buscar emoji"
                        className="h-14 w-full rounded-[28px] border-2 border-[#111b21] bg-white pl-14 pr-5 text-[18px] outline-none placeholder:text-[#667781]"
                      />
                    </div>
                    <div className="mb-3 text-[17px] font-semibold text-[#667781]">Recientes</div>
                    <div className="grid max-h-[430px] grid-cols-12 gap-2 overflow-y-auto pr-2">
                      {emojiList.map((emoji, index) => (
                        <button
                          key={`${emoji}-${index}`}
                          type="button"
                          onClick={() => setMessageInput((value) => `${value}${emoji}`)}
                          className="grid h-11 w-11 place-items-center rounded-lg text-[30px] hover:bg-[#f5f6f6]"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex h-14 items-center justify-center border-t border-[#eef0f2]">
                    <div className="flex overflow-hidden rounded-full border border-[#d1d7db]">
                      <button type="button" className="h-9 w-24 bg-[#f5f6f6] text-sm font-semibold">
                        🙂
                      </button>
                      <button type="button" className="h-9 w-24 text-sm font-semibold text-[#667781]">
                        GIF
                      </button>
                      <button type="button" className="h-9 w-24 text-sm font-semibold text-[#667781]">
                        <Sticker className="mx-auto h-5 w-5" />
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
	              {quickReplyOpen ? (
	                <div className="mx-auto mb-3 max-h-60 max-w-[1320px] overflow-y-auto rounded-xl border border-[#d1d7db] bg-white shadow-[0_10px_32px_rgba(11,20,26,0.16)]">
	                  {visibleQuickReplies.length > 0 ? (
	                    visibleQuickReplies.map((r, index) => (
	                      <button
	                        key={r.id}
	                        type="button"
	                        onMouseEnter={() => setQuickReplyHighlightIndex(index)}
	                        onClick={() => selectQuickReply(r)}
	                        className={`flex w-full items-center gap-3 border-b border-[#f0f2f5] px-4 py-3 text-left transition ${
	                          index === quickReplyHighlightIndex ? "bg-[#eef7f4]" : "hover:bg-[#f5f6f6]"
	                        }`}
	                      >
	                        <span className="shrink-0 font-mono text-sm font-semibold text-[#008069]">
	                          /{r.shortcut}
                        </span>
                        <span className="shrink-0 font-semibold">{r.title || "(sin título)"}</span>
                        <span className="truncate text-sm text-[#667781]">{r.body}</span>
                        {r.attachments.length > 0 ? (
                          <Paperclip className="h-4 w-4 shrink-0 text-[#667781]" />
                        ) : null}
	                      </button>
	                    ))
	                  ) : (
	                    <div className="p-4 text-center text-sm text-[#667781]">
	                      {quickReplyCommandQuery ? "Sin coincidencias." : "No tienes respuestas rápidas."}{" "}
	                      <Link href="/quick-replies" className="text-[#008069] underline">
	                        Crear
                      </Link>
                    </div>
	                  )}
	                </div>
	              ) : null}
		              {replyToMessage ? (
		                <div className="mx-auto mb-2 flex max-w-[1320px] items-center gap-3 rounded-xl border border-[#dce5e8] border-l-4 border-l-[#008069] bg-white px-4 py-2 shadow-sm">
		                  <CornerUpLeft className="h-4 w-4 shrink-0 text-[#008069]" />
		                  <div className="min-w-0 flex-1">
		                    <div className="text-[12px] font-semibold leading-4 text-[#008069]">Responder</div>
		                    <div className="truncate text-[13px] leading-5 text-[#54656f]">
		                      {messageActionText(replyToMessage)}
		                    </div>
		                  </div>
		                  <button
		                    type="button"
		                    onClick={() => setReplyToMessage(null)}
		                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[#667781] hover:bg-[#f0f2f5] hover:text-[#111b21]"
		                    aria-label="Cancelar respuesta"
		                  >
		                    <X className="h-4 w-4" />
			                  </button>
			                </div>
			              ) : null}
			              {isRecordingAudio ? (
			                <div className="mx-auto mb-2 flex max-w-[1320px] items-center gap-3 rounded-2xl border border-[#ffd6d1] bg-white px-4 py-2 shadow-sm">
			                  <span className="relative flex h-3 w-3 shrink-0">
			                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#d92d20] opacity-75" />
			                    <span className="relative inline-flex h-3 w-3 rounded-full bg-[#d92d20]" />
			                  </span>
			                  <div className="min-w-0 flex-1">
			                    <div className="text-[13px] font-semibold text-[#111b21]">Grabando mensaje de voz</div>
			                    <div className="font-mono text-[12px] text-[#667781]">
			                      {formatAudioDuration(audioRecordingSeconds)}
			                    </div>
			                  </div>
			                  <button
			                    type="button"
			                    onClick={() => stopAudioRecording(false)}
			                    className="rounded-full px-3 py-1.5 text-[13px] font-semibold text-[#667781] hover:bg-[#f0f2f5]"
			                  >
			                    Cancelar
			                  </button>
			                  <button
			                    type="button"
			                    onClick={() => stopAudioRecording(true)}
			                    className="rounded-full bg-[#008069] px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-[#006e5a]"
			                  >
			                    Enviar
			                  </button>
			                </div>
			              ) : null}
			              {pendingFiles.length > 0 ? (
			                <div className="mx-auto mb-3 flex max-w-[1120px] gap-2 overflow-x-auto rounded-2xl bg-white p-2 shadow-sm">
	                  {pendingFiles.map((file, index) => (
	                    <PendingFileTile
                      key={`${file.name}-${file.size}-${file.lastModified}`}
                      file={file}
                      onRemove={() =>
                        setPendingFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))
                      }
                    />
	                  ))}
	                </div>
	              ) : null}
	              <form onSubmit={handleSend} className="mx-auto flex max-w-[1320px] items-end gap-2.5">
	                <button
	                  type="button"
	                  onClick={() => {
	                    if (!currentPermissions.canSendMedia && !currentPermissions.canUseQuickReplies) {
	                      toast.error("No tienes permiso para enviar adjuntos");
	                      return;
                    }
                    setAttachmentMenuOpen((v) => !v);
	                    closeMenus(setLabelMenuOpen, setAppMenuOpen, setChatMenuOpen, setHeaderLabelsOpen, setEmojiOpen, setQuickReplyOpen);
	                  }}
	                  disabled={!currentPermissions.canSendMedia && !currentPermissions.canUseQuickReplies}
	                  className={`grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-[#111b21] shadow-sm ring-1 ring-black/[0.04] transition hover:bg-[#f5f6f6] ${
	                    attachmentMenuOpen ? "text-[#008069]" : ""
	                  } disabled:cursor-not-allowed disabled:opacity-45`}
                  aria-label="Abrir adjuntos"
                >
                  <Plus className="h-6 w-6" />
                </button>
                <div className="flex min-h-[52px] flex-1 items-end rounded-[26px] bg-white px-3 py-2 shadow-sm ring-1 ring-black/[0.04] transition focus-within:ring-[#00a884]/35">
                  <button
                    type="button"
                    onClick={() => {
                      setEmojiOpen((v) => !v);
                      closeMenus(setLabelMenuOpen, setAppMenuOpen, setChatMenuOpen, setHeaderLabelsOpen, setAttachmentMenuOpen, setQuickReplyOpen);
                    }}
                    className={`mr-2 grid h-9 w-9 shrink-0 place-items-center rounded-full transition hover:bg-[#f5f6f6] ${
                      emojiOpen ? "text-[#008069]" : "text-[#111b21]"
                    }`}
                    aria-label="Abrir emojis"
                  >
                    <Smile className="h-6 w-6" />
                  </button>
		                  <textarea
		                    ref={messageTextareaRef}
		                    value={messageInput}
	                    onChange={(e) => {
	                      const nextValue = e.target.value;
	                      setMessageInput(nextValue);
	                      if (nextValue.startsWith("/") && currentPermissions.canUseQuickReplies) {
	                        quickReplySlashOpenRef.current = true;
	                        setQuickReplyOpen(true);
	                        closeMenus(
	                          setLabelMenuOpen,
	                          setAppMenuOpen,
	                          setChatMenuOpen,
	                          setHeaderLabelsOpen,
	                          setAttachmentMenuOpen,
	                          setEmojiOpen,
	                        );
	                      }
	                    }}
	                    onKeyDown={(e) => {
	                      const canUseSlashReplies =
	                        quickReplyOpen && quickReplyCommandActive && currentPermissions.canUseQuickReplies;
	                      if (canUseSlashReplies && e.key === "ArrowDown") {
	                        e.preventDefault();
	                        setQuickReplyHighlightIndex((current) =>
	                          visibleQuickReplies.length === 0
	                            ? 0
	                            : (current + 1) % visibleQuickReplies.length,
	                        );
	                        return;
	                      }
	                      if (canUseSlashReplies && e.key === "ArrowUp") {
	                        e.preventDefault();
	                        setQuickReplyHighlightIndex((current) =>
	                          visibleQuickReplies.length === 0
	                            ? 0
	                            : (current - 1 + visibleQuickReplies.length) % visibleQuickReplies.length,
	                        );
	                        return;
	                      }
	                      if (canUseSlashReplies && e.key === "Escape") {
	                        e.preventDefault();
	                        quickReplySlashOpenRef.current = false;
	                        setQuickReplyOpen(false);
	                        return;
	                      }
	                      if (e.key === "Enter" && !e.shiftKey) {
	                        e.preventDefault();
	                        if (canUseSlashReplies) {
	                          const reply = visibleQuickReplies[quickReplyHighlightIndex] ?? visibleQuickReplies[0];
	                          if (reply) selectQuickReply(reply);
	                          return;
	                        }
	                        handleSend(e);
	                      }
	                    }}
	                    disabled={!currentPermissions.canReply}
	                    placeholder={
	                      currentPermissions.canReply ? "Escribe un mensaje" : "Sin permiso para responder"
	                    }
	                    className="min-h-6 max-h-[68px] w-full resize-none bg-transparent py-0.5 text-[16px] leading-5 text-[#111b21] outline-none placeholder:text-[#7a7f83]"
	                    rows={1}
	                  />
	                </div>
	                <Button
	                  type="button"
	                  size="icon"
	                  onClick={() => {
	                    if (isRecordingAudio) {
	                      stopAudioRecording(true);
	                      return;
	                    }
	                    if (messageInput.trim() || pendingFiles.length > 0) {
	                      handleSend();
	                      return;
	                    }
	                    void startAudioRecording();
	                  }}
		                  disabled={sendMessage.isPending || sendMediaFiles.isPending || !currentPermissions.canReply}
	                  className={`h-11 w-11 shrink-0 rounded-full shadow-sm ring-1 ring-black/[0.04] disabled:opacity-60 ${
	                    isRecordingAudio
	                      ? "bg-[#d92d20] text-white hover:bg-[#b42318]"
	                      : messageInput.trim() || pendingFiles.length > 0
	                      ? "bg-[#111b21] text-white hover:bg-[#222e35]"
	                      : "bg-white text-[#111b21] hover:bg-[#f5f6f6]"
	                  }`}
	                  aria-label={isRecordingAudio ? "Enviar mensaje de voz" : messageInput.trim() || pendingFiles.length > 0 ? "Enviar" : "Mensaje de voz"}
	                >
	                  {isRecordingAudio ? (
	                    <Send className="h-5 w-5" />
	                  ) : messageInput.trim() || pendingFiles.length > 0 ? (
	                    <Send className="h-5 w-5" />
	                  ) : (
                    <Mic className="h-6 w-6" />
                  )}
                </Button>
              </form>
            </footer>
          </>
        )}
      </main>
	      {agentPanelOpen ? (
	        <div
	          className="fixed inset-0 z-[100] bg-[#f6f7f7]"
	          role="dialog"
	          aria-modal="true"
	          aria-label="Agente IA"
	        >
	          <div
	            className="flex h-full w-full flex-col overflow-hidden bg-white"
	          >
	            <header className="flex h-[72px] shrink-0 items-center gap-3 border-b border-[#e4e7e8] bg-white px-5 md:px-8">
		              <span className={`relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#e5f6ef] text-[25px] ${
		                agentIsLive ? "agent-live-pulse text-[#008069]" : ""
		              }`}>
		                🙋
                    {agentIsLive ? (
                      <span className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full border border-white bg-[#00c853] shadow-[0_0_10px_rgba(0,200,83,0.95)]" />
                    ) : null}
	              </span>
              <div className="min-w-0 flex-1">
	                <h2 className="truncate text-[19px] font-semibold text-[#111b21]">Agente IA</h2>
	                <p className="truncate text-[12px] font-semibold text-[#667781]">
	                  {agentEnabled
	                    ? agentSettings?.configured
	                      ? "Activo para responder clientes"
	                      : "Falta conectar OpenAI"
	                    : "Pausado"}
	                </p>
              </div>
	              <button
	                type="button"
	                onClick={() => setAgentSettingsOpen((value) => !value)}
	                className={`grid h-10 w-10 place-items-center rounded-full border transition-colors ${
                  agentSettingsOpen
                    ? "border-[#008069] bg-[#e5f6ef] text-[#008069]"
                    : "border-[#d1d7db] text-[#54656f] hover:bg-[#f0f2f5]"
                }`}
                aria-label="Configuración del agente"
              >
	                <Settings className="h-5 w-5" />
	              </button>
	              <button
                type="button"
                onClick={() => setAgentPanelOpen(false)}
                className="grid h-10 w-10 place-items-center rounded-full text-[#667781] hover:bg-[#f0f2f5] hover:text-[#111b21]"
                aria-label="Cerrar agente"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

	            <div
	              className={`grid min-h-0 flex-1 grid-cols-1 overflow-hidden bg-[#f6f7f7] ${
	                agentSettingsOpen ? "lg:grid-cols-[minmax(0,1fr)_390px]" : ""
	              }`}
	            >
	              <ScrollArea className="min-h-0">
	                <div className="mx-auto max-w-[1480px] space-y-6 p-5 md:p-8">
	                  <section className="grid gap-3 md:grid-cols-3">
	                    <label className="flex min-h-[78px] cursor-pointer items-center gap-3 rounded-xl border border-[#dce3df] bg-[#fbfbfa] px-4">
                      <input
                        type="checkbox"
                        checked={agentEnabled}
                        onChange={(event) => setAgentEnabled(event.target.checked)}
                        className="h-5 w-5 accent-[#008069]"
                      />
                      <span>
                        <span className="block text-[15px] font-semibold text-[#111b21]">Agente activo</span>
                        <span className="block text-[12px] leading-4 text-[#667781]">Responde cuando la regla lo permite.</span>
                      </span>
                    </label>
                    <label className="flex min-h-[78px] cursor-pointer items-center gap-3 rounded-xl border border-[#dce3df] bg-[#fbfbfa] px-4">
                      <input
                        type="checkbox"
                        checked={agentVoiceReplies}
                        onChange={(event) => setAgentVoiceReplies(event.target.checked)}
                        className="h-5 w-5 accent-[#008069]"
                      />
                      <span>
                        <span className="block text-[15px] font-semibold text-[#111b21]">Responder en voz</span>
                        <span className="block text-[12px] leading-4 text-[#667781]">Usa voz si el cliente manda audio.</span>
                      </span>
                    </label>
                    <label className="flex min-h-[78px] cursor-pointer items-center gap-3 rounded-xl border border-[#dce3df] bg-[#fbfbfa] px-4">
                      <input
                        type="checkbox"
                        checked={agentAudioToText}
                        onChange={(event) => setAgentAudioToText(event.target.checked)}
                        className="h-5 w-5 accent-[#008069]"
                      />
                      <span>
                        <span className="block text-[15px] font-semibold text-[#111b21]">Audio a texto</span>
                        <span className="block text-[12px] leading-4 text-[#667781]">Descomprime audio y responde texto.</span>
                      </span>
                    </label>
                  </section>

                  <section>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h3 className="text-[17px] font-semibold text-[#111b21]">Entrenamiento</h3>
                      <span className="rounded-full bg-[#f0f2f5] px-3 py-1 text-[12px] font-semibold text-[#667781]">
                        {agentTrainingCards.filter((card) => agentTrainingEnabled[card.key]).length} activos
                      </span>
                    </div>
	                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
	                      {agentTrainingCards.map((card) => {
	                        const mediaKey = card.key === "text" ? null : card.key;
	                        const mediaAssets = mediaKey ? agentTrainingAssets[mediaKey] : [];
	                        return (
	                        <div key={card.key} className="flex min-h-[300px] flex-col rounded-xl border border-[#e4e7e8] bg-white p-4 shadow-sm">
                          <div className="mb-3 flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-[16px] font-semibold text-[#111b21]">
                                {card.title}
                              </div>
                              <div className="mt-1 min-h-10 text-[12px] leading-5 text-[#667781]">
                                {card.description}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => toggleAgentTraining(card.key)}
                              className={`h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors ${
                                agentTrainingEnabled[card.key] ? "bg-[#008069]" : "bg-[#d1d7db]"
                              }`}
                              aria-label={`Activar entrenamiento en ${card.title}`}
                            >
                              <span
                                className={`block h-5 w-5 rounded-full bg-white transition-transform ${
                                  agentTrainingEnabled[card.key] ? "translate-x-5" : ""
                                }`}
                              />
                            </button>
                          </div>
	                          {card.key === "text" ? (
	                            <div className="flex min-h-0 flex-1 flex-col gap-3">
	                              <button
	                                type="button"
	                                onClick={() => openAgentTextRuleEditor()}
	                                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border border-[#d1d7db] bg-white px-4 text-[13px] font-semibold text-[#111b21] hover:bg-[#f5f6f6]"
	                              >
	                                <Plus className="h-4 w-4" />
	                                Agregar regla
	                              </button>
	                              <div className="max-h-[280px] space-y-2 overflow-y-auto pr-1">
	                                {agentTextRules.length === 0 ? (
	                                  <div className="grid min-h-[116px] place-items-center rounded-lg border border-dashed border-[#dce3df] bg-[#fbfbfa] px-3 text-center text-[12px] font-semibold text-[#8696a0]">
	                                    Sin instrucciones guardadas.
	                                  </div>
	                                ) : (
	                                  agentTextRules.map((rule, index) => {
	                                    const instructions = rule.response || rule.trigger;
	                                    return (
	                                      <div key={rule.id} className="rounded-lg border border-[#e4e7e8] bg-[#fbfbfa] p-3">
	                                        <div className="mb-2 flex items-center justify-between gap-2">
	                                          <div className="flex min-w-0 items-center gap-2">
	                                            <span className="grid h-6 min-w-6 place-items-center rounded-full bg-[#e5f6ef] px-1 text-[11px] font-bold text-[#008069]">
	                                              {index + 1}
	                                            </span>
	                                            <span className="truncate text-[12px] font-semibold text-[#111b21]">
	                                              Información del negocio
	                                            </span>
	                                          </div>
	                                          <div className="flex shrink-0 items-center gap-1">
	                                            <button
	                                              type="button"
	                                              onClick={() => openAgentTextRuleEditor(rule)}
	                                              className="grid h-7 w-7 place-items-center rounded-full text-[#667781] hover:bg-white hover:text-[#111b21]"
	                                              aria-label="Editar regla"
	                                            >
	                                              <Pencil className="h-3.5 w-3.5" />
	                                            </button>
	                                            <button
	                                              type="button"
	                                              onClick={() => removeAgentTextRule(rule.id)}
	                                              className="grid h-7 w-7 place-items-center rounded-full text-[#b42318] hover:bg-white"
	                                              aria-label="Eliminar regla"
	                                            >
	                                              <Trash2 className="h-3.5 w-3.5" />
	                                            </button>
	                                          </div>
	                                        </div>
	                                        <p className="max-h-[64px] overflow-hidden text-[12px] leading-5 text-[#54656f]">
	                                          {instructions}
	                                        </p>
	                                      </div>
	                                    );
	                                  })
	                                )}
	                              </div>
	                            </div>
	                          ) : mediaKey ? (
	                            <div className="flex min-h-0 flex-1 flex-col gap-2">
	                              <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-[#cfd8dc] bg-[#fbfbfa] px-3 text-[12px] font-semibold text-[#54656f] hover:bg-[#f5f6f6]">
	                                <input
	                                  type="file"
	                                  className="hidden"
	                                  accept={card.accept}
	                                  onChange={(event) => {
	                                    addAgentTrainingAsset(mediaKey, event.currentTarget.files?.[0]);
	                                    event.currentTarget.value = "";
	                                  }}
	                                />
	                                <Plus className="h-4 w-4" />
	                                {mediaKey === "images" ? "Agregar imagen" : mediaKey === "video" ? "Agregar video" : "Agregar PDF"}
	                              </label>
	                              <div className="max-h-[280px] space-y-2 overflow-y-auto pr-1">
	                                {mediaAssets.length === 0 ? (
	                                  <div className="grid min-h-[116px] place-items-center rounded-lg border border-dashed border-[#dce3df] bg-[#fbfbfa] px-3 text-center text-[12px] font-semibold text-[#8696a0]">
	                                    Cargar {card.title.toLowerCase()}
	                                  </div>
	                                ) : (
	                                  mediaAssets.map((asset, index) => (
	                                    <div key={asset.id} className="rounded-lg border border-[#e4e7e8] bg-[#fbfbfa] p-2">
	                                      <div className="mb-2 flex items-center gap-2">
	                                        <span className={`grid h-8 min-w-8 place-items-center rounded-md px-1 text-[10px] font-bold text-white ${fileBadge(asset.file.name, asset.file.type).color}`}>
	                                          {fileBadge(asset.file.name, asset.file.type).label}
	                                        </span>
	                                        <div className="min-w-0 flex-1">
	                                          <div className="truncate text-[12px] font-semibold text-[#111b21]">
	                                            {index + 1}. {asset.file.name}
	                                          </div>
	                                          <div className="text-[10px] font-semibold text-[#8696a0]">
	                                            {formatFileSize(asset.file.size)}
	                                          </div>
	                                        </div>
	                                        <button
	                                          type="button"
	                                          onClick={() => removeAgentTrainingAsset(mediaKey, asset.id)}
	                                          className="grid h-7 w-7 place-items-center rounded-full text-[#8696a0] hover:bg-white hover:text-[#111b21]"
	                                          aria-label="Eliminar archivo"
	                                        >
	                                          <X className="h-4 w-4" />
	                                        </button>
	                                      </div>
	                                      <input
	                                        value={asset.trigger}
	                                        onChange={(event) => updateAgentTrainingAsset(mediaKey, asset.id, event.target.value)}
	                                        placeholder={
	                                          mediaKey === "images"
	                                            ? "Disparador: enviar imagen cuando..."
	                                            : mediaKey === "video"
	                                              ? "Disparador: enviar video cuando..."
	                                              : "Disparador: enviar PDF cuando..."
	                                        }
	                                        className="h-9 w-full rounded-lg border border-[#d1d7db] bg-white px-3 text-[12px] outline-none placeholder:text-[#8696a0] focus:border-[#008069]"
	                                      />
	                                    </div>
	                                  ))
	                                )}
	                              </div>
	                            </div>
	                          ) : null}
                        </div>
	                        );
	                      })}
                    </div>
                  </section>

	                  <section className="mt-12 border-t border-[#e4e7e8] pt-4">
                    <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[#667781]">Flujo de voz</h3>
                    <div className="mt-3 flex flex-wrap items-center gap-x-10 gap-y-2">
                      {[
                        "Recibir audio",
                        agentAudioToText ? "Transcribir a texto" : "Omitir transcripción",
                        agentVoiceReplies ? "Responder en voz o texto" : "Responder solo texto",
                      ].map((step, index) => (
                        <div key={step} className="flex min-w-[210px] items-center gap-2 text-[12px] font-semibold text-[#3b4a54]">
                          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#e5f6ef] text-[11px] text-[#008069]">
                            {index + 1}
                          </span>
                          <span className="min-w-0 truncate">{step}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              </ScrollArea>

	              <aside className={`${agentSettingsOpen ? "flex" : "hidden"} min-h-0 flex-col border-l border-[#e4e7e8] bg-white`}>
	                <div className="shrink-0 border-b border-[#e4e7e8] px-5 py-5">
                  <div className="flex items-center gap-2 text-[16px] font-semibold text-[#111b21]">
                    <Settings className="h-4 w-4" />
                    Configuración
                  </div>
                  <div className="mt-1 text-[12px] leading-5 text-[#667781]">
                    Reglas para elegir qué chats atiende el agente.
                  </div>
                </div>
                <ScrollArea className="min-h-0 flex-1">
	                  <div className="space-y-4 p-5">
                    {agentResponseScopeOptions.map((option) => (
                      <label
                        key={option.key}
                        className={`flex cursor-pointer gap-3 rounded-xl border bg-white p-3 text-left ${
                          agentResponseScope === option.key
                            ? "border-[#008069] ring-2 ring-[#008069]/10"
                            : "border-[#e4e7e8]"
                        }`}
                      >
                        <input
                          type="radio"
                          name="agent-scope"
                          checked={agentResponseScope === option.key}
                          onChange={() => setAgentResponseScope(option.key)}
                          className="mt-1 h-4 w-4 accent-[#008069]"
                        />
                        <span className="min-w-0">
                          <span className="block text-[13px] font-semibold text-[#111b21]">{option.title}</span>
                          <span className="mt-0.5 block text-[11px] leading-4 text-[#667781]">{option.description}</span>
                        </span>
                      </label>
                    ))}

                    <div className="rounded-xl border border-[#e4e7e8] bg-white p-3">
                      <div className="mb-2 text-[13px] font-semibold text-[#111b21]">Etiquetas / carpetas</div>
                      {labels && labels.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {labels.map((label) => {
                            const selected = agentSelectedLabelIds.includes(label.id);
                            return (
                              <button
                                key={label.id}
                                type="button"
                                onClick={() => toggleAgentLabel(label.id)}
                                className={`flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold ${
                                  selected
                                    ? "border-[#008069] bg-[#e5f6ef] text-[#008069]"
                                    : "border-[#d1d7db] bg-white text-[#54656f] hover:bg-[#f5f6f6]"
                                }`}
                              >
                                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: label.color }} />
                                <span className="truncate">{label.name}</span>
                                {selected ? <Check className="h-3 w-3 shrink-0" /> : null}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="rounded-lg bg-[#f7f8f8] px-3 py-3 text-[12px] text-[#667781]">
                          Sin etiquetas creadas.
                        </div>
                      )}
                      {agentSelectedLabels.length > 0 ? (
                        <div className="mt-3 text-[11px] leading-4 text-[#667781]">
                          Seleccionadas: {agentSelectedLabels.map((label) => label.name).join(", ")}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </ScrollArea>
              </aside>
            </div>

            {agentTextRuleEditor ? (
              <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/35 px-4">
                <div className="flex max-h-[82dvh] w-full max-w-[760px] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_80px_rgba(11,20,26,0.28)] lg:w-[50vw]">
                  <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#eef0f2] px-5 py-4">
                    <div className="min-w-0">
                      <h3 className="truncate text-[18px] font-semibold text-[#111b21]">
                        {agentTextRuleEditor.mode === "edit" ? "Editar regla" : "Agregar regla"}
                      </h3>
                      <p className="mt-1 text-[12px] leading-4 text-[#667781]">
                        Agrega instrucciones e información de tu negocio para el agente.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAgentTextRuleEditor(null)}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[#667781] hover:bg-[#f0f2f5] hover:text-[#111b21]"
                      aria-label="Cerrar regla"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </header>
                  <div className="min-h-0 flex-1 p-5">
                    <label className="block text-[13px] font-semibold text-[#111b21]">
                      Instrucciones del negocio
                    </label>
                    <textarea
                      value={agentTextRuleEditor.instructions}
                      onChange={(event) =>
                        setAgentTextRuleEditor((current) =>
                          current ? { ...current, instructions: event.target.value } : current,
                        )
                      }
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                          event.preventDefault();
                          saveAgentTextRule();
                        }
                      }}
                      placeholder="Escribe aquí información de tu negocio: horarios, precios, servicios, políticas, forma de atención y cualquier instrucción que debe seguir el agente."
                      className="mt-2 min-h-[300px] w-full resize-none rounded-xl border border-[#d1d7db] bg-white px-4 py-3 text-[14px] leading-6 text-[#111b21] outline-none placeholder:text-[#8696a0] focus:border-[#008069] lg:min-h-[360px]"
                      autoFocus
                    />
                  </div>
                  <footer className="flex shrink-0 justify-end gap-2 border-t border-[#eef0f2] px-5 py-4">
                    <button
                      type="button"
                      onClick={() => setAgentTextRuleEditor(null)}
                      className="h-10 rounded-lg border border-[#d1d7db] px-4 text-[13px] font-semibold text-[#54656f] hover:bg-[#f5f6f6]"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={saveAgentTextRule}
                      className="h-10 rounded-lg bg-[#008069] px-5 text-[13px] font-semibold text-white hover:bg-[#027a62]"
                    >
                      Guardar
                    </button>
                  </footer>
                </div>
              </div>
            ) : null}

	            <footer className="grid shrink-0 gap-3 border-t border-[#e4e7e8] bg-white px-5 py-4 md:grid-cols-[minmax(220px,1fr)_minmax(180px,260px)_auto] md:px-8">
	              <label className="min-w-0">
	                <span className="mb-1 block text-[12px] font-semibold text-[#54656f]">API key de OpenAI</span>
	                <div className="relative">
	                  <input
	                    value={agentOpenAiApiKey}
	                    onChange={(event) => setAgentOpenAiApiKey(event.target.value)}
	                    type="password"
		                    placeholder={agentApiKeyPlaceholder}
	                    className="h-10 w-full rounded-lg border border-[#d1d7db] px-3 pr-28 text-[13px] outline-none focus:border-[#008069]"
	                  />
	                  <span
	                    className={`pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-2 py-1 text-[11px] font-semibold ${
	                      agentSettings?.configured
	                        ? "bg-[#e5f6ef] text-[#008069]"
	                        : "bg-[#f0f2f5] text-[#667781]"
	                    }`}
	                  >
	                    {agentSettings?.configured ? "Configurado" : "Pendiente"}
	                  </span>
	                </div>
	              </label>
		              <div className="min-w-0">
		                <div className="mb-1 flex items-center justify-between gap-2">
		                  <label htmlFor="agent-model-select" className="block text-[12px] font-semibold text-[#54656f]">
		                    Modelo
		                  </label>
		                  <button
		                    type="button"
		                    onClick={() => loadAgentModels.mutate()}
		                    disabled={loadAgentModels.isPending || !canLoadAgentModels}
		                    className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-[#008069] hover:bg-[#e5f6ef] disabled:cursor-not-allowed disabled:text-[#aebac1] disabled:hover:bg-transparent"
		                  >
		                    {loadAgentModels.isPending ? "Cargando" : "Actualizar"}
		                  </button>
		                </div>
		                <div className="relative">
		                  <select
		                    id="agent-model-select"
		                    value={agentModel}
		                    onChange={(event) => setAgentModel(event.target.value)}
		                    className="h-10 w-full appearance-none rounded-lg border border-[#d1d7db] bg-white px-3 pr-9 text-[13px] outline-none focus:border-[#008069]"
		                  >
		                    {agentModelOptions.map((model) => (
		                      <option key={model} value={model}>
		                        {model}
		                      </option>
		                    ))}
		                  </select>
		                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#667781]" />
		                </div>
		              </div>
	              <button
	                type="button"
	                onClick={() => saveAgentSettings.mutate()}
	                disabled={saveAgentSettings.isPending}
	                className="h-10 self-end rounded-lg bg-[#008069] px-5 text-[13px] font-semibold text-white hover:bg-[#027a62] disabled:cursor-not-allowed disabled:opacity-60"
	              >
	                {saveAgentSettings.isPending ? "Conectando" : "Guardar"}
	              </button>
	            </footer>
          </div>
        </div>
      ) : null}
      {assignmentTargetChat ? (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/35 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Derivar chat"
          onClick={() => setAssignmentTargetChat(null)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-[390px] overflow-hidden rounded-2xl bg-white shadow-[0_20px_60px_rgba(11,20,26,0.28)]"
          >
            <header className="flex items-center gap-3 border-b border-[#eef0f2] px-5 py-4">
              <Forward className="h-5 w-5 text-[#54656f]" />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[18px] font-semibold text-[#111b21]">Derivar chat</h2>
                <p className="truncate text-[13px] text-[#667781]">{displayChatCode(assignmentTargetChat)}</p>
              </div>
              <button
                type="button"
                onClick={() => setAssignmentTargetChat(null)}
                className="grid h-9 w-9 place-items-center rounded-full text-[#667781] hover:bg-[#f0f2f5]"
                aria-label="Cerrar derivación"
              >
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="max-h-[360px] overflow-y-auto p-2">
              {assignableCollaborators.map((collaborator) => (
                <button
                  key={collaborator.id}
                  type="button"
                  disabled={assignChat.isPending}
                  onClick={() => assignChat.mutate({ chat: assignmentTargetChat, collaborator })}
                  className="flex min-h-[54px] w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-[#f5f6f6] disabled:opacity-50"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#d7e9ff] text-[13px] font-bold text-[#0b65c2]">
                    {initials(collaborator.displayName)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-[#111b21]">
                      {collaborator.displayName}
                    </span>
                    <span className="block truncate text-[12px] text-[#667781]">{collaborator.username}</span>
                  </span>
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: collaborator.labelColor || COLLABORATOR_COLOR_OPTIONS[0] }}
                  />
                </button>
              ))}
              {assignableCollaborators.length === 0 ? (
                <div className="px-4 py-8 text-center text-[13px] text-[#667781]">Sin colaboradores.</div>
              ) : null}
            </div>
            {assignmentTargetChat.assignedTo ? (
              <footer className="border-t border-[#eef0f2] p-3">
                <button
                  type="button"
                  disabled={assignChat.isPending}
                  onClick={() => assignChat.mutate({ chat: assignmentTargetChat, collaborator: null })}
                  className="h-10 w-full rounded-full text-[14px] font-semibold text-[#b42318] hover:bg-[#fff4f4]"
                >
                  Quitar derivación
                </button>
              </footer>
            ) : null}
          </div>
        </div>
      ) : null}
      {permissionTarget ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35 px-4">
          <div className="w-full max-w-[430px] rounded-2xl bg-white shadow-[0_20px_60px_rgba(11,20,26,0.28)]">
            <header className="flex items-center justify-between border-b border-[#eef0f2] px-5 py-4">
              <div className="min-w-0">
                <h2 className="truncate text-[18px] font-semibold text-[#111b21]">
                  Permisos de {permissionTarget.displayName}
                </h2>
                <p className="truncate text-[13px] text-[#667781]">{permissionTarget.username}</p>
              </div>
              <button
                type="button"
                onClick={() => setPermissionTargetId(null)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[#667781] hover:bg-[#f0f2f5] hover:text-[#111b21]"
                aria-label="Cerrar permisos"
              >
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="space-y-1 px-5 py-4">
              {collaboratorPermissionOptions.map((option) => (
                <label
                  key={option.key}
                  className="flex min-h-[68px] cursor-pointer items-center justify-between gap-4 border-b border-[#f5f6f6] py-3 last:border-b-0"
                >
                  <span className="min-w-0">
                    <span className="block text-[15px] font-semibold text-[#111b21]">{option.title}</span>
                    <span className="block text-[13px] leading-5 text-[#667781]">{option.description}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={permissionDraft[option.key]}
                    onChange={(event) =>
                      setPermissionDraft((current) => ({
                        ...current,
                        [option.key]: event.target.checked,
                      }))
                    }
                    className="h-5 w-5 accent-[#008069]"
                  />
                </label>
              ))}
            </div>
            <footer className="flex justify-end gap-3 border-t border-[#eef0f2] px-5 py-4">
              <button
                type="button"
                onClick={() => setPermissionTargetId(null)}
                className="rounded-full px-5 py-2 text-[14px] font-semibold text-[#54656f] hover:bg-[#f0f2f5]"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={updateCollaboratorPermissions.isPending}
                onClick={() =>
                  updateCollaboratorPermissions.mutate({
                    id: permissionTarget.id,
                    permissions: permissionDraft,
                  })
                }
                className="rounded-full bg-[#008069] px-5 py-2 text-[14px] font-semibold text-white disabled:bg-[#d8dee2] disabled:text-[#8696a0]"
              >
                Guardar permisos
              </button>
            </footer>
          </div>
        </div>
      ) : null}
      {forwardMessage ? (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Reenviar mensaje"
          onClick={() => setForwardMessage(null)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="flex max-h-[82vh] w-full max-w-[430px] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_80px_rgba(11,20,26,0.34)]"
          >
            <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[#eef0f2] px-4">
              <Forward className="h-5 w-5 shrink-0 text-[#54656f]" />
              <div className="min-w-0 flex-1">
                <div className="text-[16px] font-semibold text-[#111b21]">Reenviar</div>
                <div className="truncate text-[12px] text-[#667781]">{messageActionText(forwardMessage)}</div>
              </div>
              <button
                type="button"
                onClick={() => setForwardMessage(null)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[#667781] hover:bg-[#f0f2f5] hover:text-[#111b21]"
                aria-label="Cerrar reenvio"
              >
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="border-b border-[#eef0f2] px-4 py-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#667781]" />
                <input
                  value={forwardSearchQuery}
                  onChange={(event) => setForwardSearchQuery(event.target.value)}
                  placeholder="Buscar chat"
                  className="h-10 w-full rounded-full bg-[#f0f2f5] pl-9 pr-4 text-[14px] outline-none placeholder:text-[#667781]"
                  autoFocus
                />
              </div>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="p-2">
                {forwardTargets.length > 0 ? (
                  forwardTargets.map((chat) => {
                    const targetLabel = displayChatCode(chat);
                    const targetName = displayChatName(chat);
                    return (
                      <button
                        key={chat.id}
                        type="button"
                        disabled={forwardMessageToChat.isPending || !currentPermissions.canReply}
                        onMouseEnter={() => prefetchChatMessages(chat.id)}
                        onFocus={() => prefetchChatMessages(chat.id)}
                        onClick={() => {
                          forwardMessageToChat.mutate({ chatId: chat.id, messageId: forwardMessage.id });
                        }}
                        className="flex min-h-[60px] w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-[#f5f6f6] disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <AvatarBubble
                          name={targetName || targetLabel}
                          isGroup={chat.isGroup}
                          imageUrl={chat.profilePicUrl}
                          profilePicLookupUrl={chat.profilePicLookupUrl}
                          size="sm"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[15px] font-semibold text-[#111b21]">{targetLabel}</div>
                          <div className="truncate text-[12px] text-[#667781]">{targetName}</div>
                        </div>
                        <Send className="h-4 w-4 shrink-0 text-[#008069]" />
                      </button>
                    );
                  })
                ) : (
                  <div className="px-4 py-8 text-center text-[13px] text-[#667781]">
                    No hay chats para reenviar.
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      ) : null}
      {messageInfo ? (
        <div
          className="fixed inset-0 z-[131] flex items-center justify-center bg-black/35 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Info del mensaje"
          onClick={() => setMessageInfo(null)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-[410px] overflow-hidden rounded-2xl bg-white shadow-[0_24px_80px_rgba(11,20,26,0.32)]"
          >
            <header className="flex h-14 items-center gap-3 border-b border-[#eef0f2] px-4">
              <Info className="h-5 w-5 shrink-0 text-[#54656f]" />
              <div className="min-w-0 flex-1 text-[16px] font-semibold text-[#111b21]">Info. del mensaje</div>
              <button
                type="button"
                onClick={() => setMessageInfo(null)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[#667781] hover:bg-[#f0f2f5] hover:text-[#111b21]"
                aria-label="Cerrar info"
              >
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="space-y-3 px-5 py-4 text-[14px]">
              <div className="rounded-xl bg-[#f7f8f8] px-3 py-2 text-[#111b21]">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#667781]">Contenido</div>
                <LinkifiedText text={messageActionText(messageInfo)} className="whitespace-pre-wrap break-words" />
              </div>
              <div className="grid grid-cols-[112px_1fr] gap-y-2 text-[#54656f]">
                <span>Origen</span>
                <span className="font-semibold text-[#111b21]">{messageInfo.fromMe ? "Enviado" : "Recibido"}</span>
                <span>Hora</span>
                <span className="font-semibold text-[#111b21]">{formatMessageTime(messageInfo.timestamp)}</span>
                <span>Tipo</span>
                <span className="font-semibold text-[#111b21]">{messageInfo.type || "chat"}</span>
                <span>Archivo</span>
                <span className="truncate font-semibold text-[#111b21]">
                  {messageInfo.hasMedia ? fileNameFromMessage(messageInfo) : "Sin archivo"}
                </span>
                {messageInfo.isForwarded ? (
                  <>
                    <span>Estado</span>
                    <span className="font-semibold text-[#111b21]">Reenviado</span>
                  </>
                ) : null}
              </div>
              {messageInfoMutation.isPending ? (
                <div className="rounded-xl border border-[#eef0f2] px-3 py-2 text-[12px] font-semibold text-[#667781]">
                  Consultando WhatsApp...
                </div>
              ) : messageInfo.info ? (
                <div className="grid grid-cols-[112px_1fr] gap-y-2 rounded-xl border border-[#eef0f2] px-3 py-2 text-[12px] text-[#54656f]">
                  <span>Entregado</span>
                  <span className="font-semibold text-[#111b21]">
                    {messageInfo.info.delivery.length}
                    {messageInfo.info.delivery[0]?.t ? ` - ${formatReceiptTime(messageInfo.info.delivery[0].t)}` : ""}
                  </span>
                  <span>Leído</span>
                  <span className="font-semibold text-[#111b21]">
                    {messageInfo.info.read.length}
                    {messageInfo.info.read[0]?.t ? ` - ${formatReceiptTime(messageInfo.info.read[0].t)}` : ""}
                  </span>
                </div>
              ) : null}
              <div className="break-all rounded-xl border border-[#eef0f2] px-3 py-2 font-mono text-[11px] text-[#667781]">
                {messageInfo.id}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {imagePreview ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/82 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Vista previa de imagen"
          onClick={() => setImagePreview(null)}
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setImagePreview(null);
            }}
            className="absolute right-5 top-5 grid h-10 w-10 place-items-center rounded-full bg-black/45 text-white hover:bg-black/65"
            aria-label="Cerrar imagen"
          >
            <X className="h-6 w-6" />
          </button>
          <img
            src={imagePreview.src}
            alt={imagePreview.alt}
            onClick={(event) => event.stopPropagation()}
            className="max-h-[88vh] max-w-[92vw] rounded-lg object-contain shadow-[0_20px_80px_rgba(0,0,0,0.45)]"
          />
        </div>
      ) : null}
      {notePreview?.fileUrl ? (
        <div
          className="fixed inset-0 z-[121] flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Vista previa de nota"
          onClick={() => setNotePreview(null)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="flex h-[86vh] w-full max-w-[920px] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_80px_rgba(0,0,0,0.38)]"
          >
            <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[#eef0f2] px-4">
              <FileText className="h-4 w-4 shrink-0 text-[#667781]" />
              <div className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#111b21]">
                {notePreview.fileName || "Archivo"}
              </div>
              {notePreview.fileSizeBytes ? (
                <span className="text-[11px] text-[#8696a0]">{formatFileSize(notePreview.fileSizeBytes)}</span>
              ) : null}
              <button
                type="button"
                onClick={() => setNotePreview(null)}
                className="grid h-8 w-8 place-items-center rounded-full text-[#667781] hover:bg-[#f0f2f5] hover:text-[#111b21]"
                aria-label="Cerrar vista previa"
              >
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="grid min-h-0 flex-1 place-items-center bg-[#f7f8f8] p-4">
              {noteFileKind(notePreview) === "image" ? (
                <img
                  src={notePreview.fileUrl}
                  alt={notePreview.fileName || "Archivo"}
                  className="max-h-full max-w-full rounded-lg object-contain"
                />
              ) : noteFileKind(notePreview) === "video" ? (
                <video
                  src={notePreview.fileUrl}
                  controls
                  autoPlay
                  className="max-h-full max-w-full rounded-lg bg-black"
                />
              ) : noteFileKind(notePreview) === "pdf" || noteFileKind(notePreview) === "text" ? (
                <iframe
                  src={notePreview.fileUrl}
                  title={notePreview.fileName || "Archivo"}
                  className="h-full w-full rounded-lg border border-[#e4e7e8] bg-white"
                />
              ) : (
                <div className="flex max-w-[360px] flex-col items-center rounded-xl border border-[#e4e7e8] bg-white px-6 py-8 text-center">
                  <span className={`mb-3 grid h-12 min-w-12 place-items-center rounded-lg px-2 text-[12px] font-bold text-white ${fileBadge(notePreview.fileName || "Archivo", notePreview.fileMimeType).color}`}>
                    {fileBadge(notePreview.fileName || "Archivo", notePreview.fileMimeType).label}
                  </span>
                  <div className="max-w-full truncate text-[14px] font-semibold text-[#111b21]">
                    {notePreview.fileName || "Archivo"}
                  </div>
                  <div className="mt-1 text-[12px] text-[#667781]">
                    Archivo guardado en el CRM
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {pendingPanelOpen ? (
        <aside className="absolute inset-y-0 right-0 z-[70] flex w-full max-w-[430px] flex-col border-l border-[#d1d7db] bg-white shadow-[-12px_0_30px_rgba(11,20,26,0.12)] xl:relative xl:inset-auto xl:shadow-none">
          <header className="flex h-[70px] shrink-0 items-center gap-4 border-b border-[#e4e7e8] px-5">
            <button
              type="button"
              onClick={() => setPendingPanelOpen(false)}
              className="grid h-10 w-10 place-items-center rounded-full hover:bg-[#f0f2f5]"
              aria-label="Cerrar pendientes"
            >
              <X className="h-6 w-6" />
            </button>
            <div className="min-w-0 flex-1">
              <h2 className="text-[17px] font-semibold">Pendientes</h2>
              <p className="text-[12px] text-[#667781]">
                {pendingAssignedChats.length} chat{pendingAssignedChats.length === 1 ? "" : "s"} derivado
                {pendingAssignedChats.length === 1 ? "" : "s"}
              </p>
            </div>
          </header>
          <ScrollArea className="flex-1">
            <div className="px-3 py-3">
              {pendingAssignedChats.length > 0 ? (
                pendingAssignedChats.map((chat, index) => {
                  const preview = lastMessageText(chat.lastMessage) || (chat.isGroup ? "Grupo sin mensajes" : "Sin mensajes");
                  return (
                    <button
                      key={chat.id}
                      type="button"
                      onClick={() => {
                        selectChat(chat.id);
                        setPendingPanelOpen(false);
                      }}
                      className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-[#f0f2f5]"
                    >
                      <AvatarBubble
                        name={displayChatName(chat)}
                        isGroup={chat.isGroup}
                        imageSeed={index}
                        imageUrl={chat.profilePicUrl}
                        profilePicLookupUrl={chat.profilePicLookupUrl}
                        size="xs"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-[15px] font-semibold text-[#111b21]">
                            {displayChatCode(chat)}
                          </span>
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: chat.assignedTo?.color || COLLABORATOR_COLOR_OPTIONS[0] }}
                          />
                        </span>
                        <span className="block truncate text-[12px] text-[#667781]">{preview}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block whitespace-nowrap text-[12px] font-semibold text-[#667781]">
                          {formatDateTimeLabel(chat.assignedTo?.assignedAt)}
                        </span>
                        <span
                          className="mt-1 block max-w-[92px] truncate rounded-full px-2 py-1 text-[10px] font-bold leading-none text-white"
                          style={{ backgroundColor: chat.assignedTo?.color || COLLABORATOR_COLOR_OPTIONS[0] }}
                        >
                          {chat.assignedTo?.displayName}
                        </span>
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="px-8 py-16 text-center text-[14px] leading-6 text-[#667781]">
                  No tienes chats derivados pendientes.
                </div>
              )}
            </div>
          </ScrollArea>
        </aside>
      ) : null}
      {detailsPanelOpen && activeChat ? (
        <aside className="absolute inset-y-0 right-0 z-[70] flex w-full max-w-[430px] flex-col border-l border-[#d1d7db] bg-white shadow-[-12px_0_30px_rgba(11,20,26,0.12)] xl:relative xl:inset-auto xl:shadow-none">
          {!mediaPanelOpen ? (
            <>
              <header className="flex h-[70px] shrink-0 items-center gap-4 border-b border-[#e4e7e8] px-5">
                <button
                  type="button"
                  onClick={() => setDetailsPanelOpen(false)}
                  className="grid h-10 w-10 place-items-center rounded-full hover:bg-[#f0f2f5]"
                  aria-label="Cerrar información"
                >
                  <X className="h-6 w-6" />
                </button>
                <h2 className="text-[17px] font-semibold">Info. del contacto</h2>
              </header>
              <ScrollArea className="flex-1">
                <div className="flex flex-col items-center border-b border-[#eef0f2] px-6 py-8 text-center">
                  <AvatarBubble
                    name={activeChatFullName || activeChatName}
                    isGroup={activeChat.isGroup}
                    imageUrl={activeChat.profilePicUrl}
                    profilePicLookupUrl={activeChat.profilePicLookupUrl}
                    size="lg"
                  />
                  <div className="mt-4 max-w-full truncate text-[24px] font-semibold leading-8">
                    {activeChatName}
                  </div>
                  {activeChat.labels.length > 0 ? (
                    <div className="mt-4 flex max-w-full flex-wrap justify-center gap-2">
                      {activeChat.labels.map((label) => (
                        <span key={label.id} className="flex max-w-full items-center gap-2 rounded-full px-3 py-1 text-[13px] text-[#111b21]">
                          <Folder className="h-4 w-4 fill-current" style={{ color: label.color }} />
                          <span className="truncate">{label.name}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {activeChat.isGroup ? (
                    <div className="mt-4 w-full rounded-xl bg-[#f7f8f8] px-4 py-3 text-left">
                      <div className="mb-2 text-[13px] font-semibold text-[#667781]">Códigos del grupo</div>
                      {groupMemberCodes.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {groupMemberCodes.map((member) => (
                            <button
                              key={member.id}
	                              type="button"
	                              onClick={() => {
	                                if (member.ambiguous) {
	                                  toast.error("Codigo duplicado: verifica el contacto original en WhatsApp.");
	                                } else if (member.chatId) {
	                                  setActiveChatId(member.chatId);
	                                  setDetailsPanelOpen(false);
	                                } else {
	                                  toast.info("Ese código aún no tiene chat individual en la lista.");
	                                }
	                              }}
	                              className={`rounded-full border px-3 py-1.5 text-[13px] font-semibold ${
	                                member.ambiguous
	                                  ? "border-[#f0b3b3] bg-[#fff4f4] text-[#b42318] hover:bg-[#ffe8e8]"
	                                  : "border-[#d1d7db] bg-white text-[#111b21] hover:bg-[#eef0f2]"
	                              }`}
	                            >
	                              {member.label}
	                            </button>
                          ))}
                        </div>
                      ) : isGroupParticipantsFetching ? (
                        <div className="text-[13px] text-[#667781]">Verificando códigos desde WhatsApp...</div>
                      ) : (
                        <div className="text-[13px] text-[#667781]">Sin códigos verificados desde WhatsApp.</div>
                      )}
                    </div>
                  ) : null}
                </div>
                <div className="border-b border-[#eef0f2] px-6 py-5">
                  <button
                    type="button"
                    onClick={() => {
                      setMediaPanelOpen(true);
                      setMediaPanelTab("media");
                    }}
                    className="flex w-full items-center gap-3 text-left"
                  >
                    <Image className="h-5 w-5 shrink-0 text-[#667781]" />
                    <span className="min-w-0 flex-1 text-[15px] font-semibold">
                      Archivos, enlaces y documentos
                    </span>
                    <span className="text-[14px] text-[#667781]">{mediaSummaryCount}</span>
                  </button>
                  <div className="mt-4 grid grid-cols-4 gap-2">
                    {mediaItems.slice(0, 4).map((msg) => (
                      <button
                        key={msg.id}
                        type="button"
                        onClick={() => {
                          setMediaPanelOpen(true);
                          setMediaPanelTab("media");
                        }}
                        className="aspect-square overflow-hidden rounded-md bg-[#f0f2f5]"
                      >
                        {isVideoMessage(msg) ? (
                          <VideoPreview src={msg.mediaUrl || ""} compact />
                        ) : (
                          <img src={msg.mediaUrl || ""} alt="" className="h-full w-full object-cover" />
                        )}
                      </button>
                    ))}
                    {mediaItems.length === 0
                      ? documentItems.slice(0, 4).map((msg) => {
                          const name = fileNameFromMessage(msg);
                          const badge = fileBadge(name, msg.mediaMimeType);
                          return (
                            <button
                              key={msg.id}
                              type="button"
                              onClick={() => {
                                setMediaPanelOpen(true);
                                setMediaPanelTab("docs");
                              }}
                              className="grid aspect-square place-items-center rounded-md bg-[#f0f2f5]"
                            >
                              <span className={`grid h-10 w-9 place-items-center rounded-md text-[11px] font-bold text-white ${badge.color}`}>
                                {badge.label}
                              </span>
                            </button>
                          );
                        })
                      : null}
                  </div>
                </div>
                <div className="px-6 py-2">
                  <button type="button" className="flex h-14 w-full items-center gap-4 text-left text-[15px] hover:bg-[#f7f8f8]">
                    <Star className="h-5 w-5 text-[#667781]" />
                    Mensajes destacados
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      mutateChatState.mutate({
                        chat: activeChat,
                        patch: { muted: !activeChat.muted },
                      }, {
                        onSuccess: () =>
                          toast.success(
                            activeChat.muted
                              ? "Notificaciones del chat activadas"
                              : "Notificaciones del chat silenciadas",
                          ),
                      })
                    }
                    className="flex h-14 w-full items-center gap-4 text-left text-[15px] hover:bg-[#f7f8f8]"
                  >
                    <VolumeX className={`h-5 w-5 ${activeChat.muted ? "text-[#008069]" : "text-[#667781]"}`} />
                    <span className="min-w-0 flex-1">
                      {activeChat.muted ? "Reactivar notificaciones" : "Silenciar notificaciones"}
                    </span>
                    <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                      activeChat.muted ? "bg-[#f0f2f5] text-[#667781]" : "bg-[#e5f6ef] text-[#008069]"
                    }`}>
                      {activeChat.muted ? "Silenciado" : "Activo"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      mutateChatState.mutate({
                        chat: activeChat,
                        patch: { emailNotifications: !(activeChat.emailNotifications !== false) },
                      }, {
                        onSuccess: () =>
                          toast.success(
                            activeChat.emailNotifications !== false
                              ? "Notificaciones por correo desactivadas"
                              : "Notificaciones por correo activadas",
                          ),
                      })
                    }
                    className="flex h-14 w-full items-center gap-4 text-left text-[15px] hover:bg-[#f7f8f8]"
                  >
                    <MailPlus className={`h-5 w-5 ${activeChat.emailNotifications !== false ? "text-[#008069]" : "text-[#667781]"}`} />
                    <span className="min-w-0 flex-1">Notificaciones por correo</span>
                    <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                      activeChat.emailNotifications !== false
                        ? "bg-[#e5f6ef] text-[#008069]"
                        : "bg-[#f0f2f5] text-[#667781]"
                    }`}>
                      {activeChat.emailNotifications !== false ? "Activo" : "Inactivo"}
                    </span>
                  </button>
                </div>
                <div className="border-t border-[#eef0f2] px-6 py-4">
                  <div className="mb-3 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.04em] text-[#667781]">
                    <span>Notas</span>
                    <span>{activeNotes.length}</span>
                  </div>
                  {activeNotes.length > 0 ? (
                    <div className="space-y-1.5">
                      {activeNotes.map((note) => {
                        const fileLabel = note.fileName || "Archivo";
                        const badge = fileBadge(fileLabel, note.fileMimeType);
                        return (
                          <div key={note.id} className="rounded-md bg-[#f7f8f8] px-2.5 py-2 text-[10px] leading-4 text-[#54656f]">
                            <div className="flex items-center gap-1.5 text-[#111b21]">
                              <span className="max-w-[130px] truncate font-semibold">
                                {note.authorDisplayName || note.authorUsername}
                              </span>
                              <span className="text-[#8696a0]">{formatNoteTime(note.createdAt)}</span>
                            </div>
                            {note.body ? (
                              <div className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-[#54656f]">
                                {note.body}
                              </div>
                            ) : null}
                            {note.fileName ? (
                              <button
                                type="button"
                                disabled={!note.fileUrl}
                                onClick={() => setNotePreview(note)}
                                className="mt-1 flex w-full items-center gap-1.5 rounded-[6px] text-left text-[#111b21] hover:bg-white disabled:cursor-default"
                              >
                                <span className={`grid h-4 min-w-5 place-items-center rounded-[3px] px-1 text-[8px] font-bold text-white ${badge.color}`}>
                                  {badge.label}
                                </span>
                                <span className="min-w-0 flex-1 truncate">{note.fileName}</span>
                                {note.fileSizeBytes ? (
                                  <span className="shrink-0 text-[#8696a0]">{formatFileSize(note.fileSizeBytes)}</span>
                                ) : null}
                              </button>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-[10px] text-[#8696a0]">Sin notas</div>
                  )}
                  <div
                    onDragOver={(event) => {
                      event.preventDefault();
                      setIsDraggingNoteFiles(true);
                    }}
                    onDragLeave={(event) => {
                      const nextTarget = event.relatedTarget;
                      if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
                      setIsDraggingNoteFiles(false);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      setIsDraggingNoteFiles(false);
                      addNoteFiles(event.dataTransfer.files);
                    }}
                    className="mt-3 space-y-2"
                  >
                    <input
                      ref={noteFileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(event) => addNoteFiles(event.target.files ?? [])}
                    />
                    {noteFiles.length > 0 ? (
                      <div className="space-y-1.5 rounded-2xl border border-[#e4e7e8] bg-white px-2 py-2">
                        {noteFiles.map((file) => {
                          const badge = fileBadge(file.name, file.type);
                          return (
                            <div key={`${file.name}:${file.size}:${file.lastModified}`} className="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 text-[10px] text-[#54656f]">
                              <span className={`grid h-5 min-w-6 place-items-center rounded-[4px] px-1 text-[8px] font-bold text-white ${badge.color}`}>
                                {badge.label}
                              </span>
                              <span className="min-w-0 flex-1 truncate">{file.name}</span>
                              <span className="shrink-0">{formatFileSize(file.size)}</span>
                              <button
                                type="button"
                                onClick={() => setNoteFiles((current) => current.filter((item) => item !== file))}
                                className="grid h-5 w-5 shrink-0 place-items-center rounded-full hover:bg-[#f0f2f5]"
                                aria-label="Quitar archivo"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                    <div
                      className={`flex min-h-12 items-center gap-2 rounded-full border bg-white px-2 py-1 shadow-sm transition-colors ${
                        isDraggingNoteFiles
                          ? "border-[#008069] bg-[#e5f6ef] ring-2 ring-[#00a884]/20"
                          : "border-[#d1d7db]"
                      }`}
                      onClick={() => noteTextareaRef.current?.focus()}
                    >
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          noteFileInputRef.current?.click();
                        }}
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[#54656f] transition hover:bg-[#f0f2f5] hover:text-[#111b21]"
                        aria-label="Agregar archivo a la nota"
                      >
                        <Plus className="h-5 w-5" />
                      </button>
                      <textarea
                        ref={noteTextareaRef}
                        value={noteBody}
                        onChange={(event) => setNoteBody(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            if (!createChatNote.isPending && (noteBody.trim() || noteFiles.length > 0)) {
                              createChatNote.mutate();
                            }
                          }
                        }}
                        rows={1}
                        maxLength={4000}
                        placeholder="Arrastra fotos, videos o documentos aqui"
                        className="min-h-7 max-h-24 min-w-0 flex-1 resize-none bg-transparent px-1 py-1 text-[13px] leading-5 text-[#111b21] outline-none placeholder:text-[#8696a0]"
                      />
                      <Mic className="h-4 w-4 shrink-0 text-[#667781]" aria-hidden="true" />
                      <button
                        type="button"
                        title="Enviar nota"
                        aria-label="Enviar nota"
                        disabled={createChatNote.isPending || (!noteBody.trim() && noteFiles.length === 0)}
                        onClick={(event) => {
                          event.stopPropagation();
                          createChatNote.mutate();
                        }}
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#111b21] text-white shadow-sm transition hover:bg-[#263238] disabled:bg-[#d8dee2] disabled:text-[#8696a0]"
                      >
                        {createChatNote.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ArrowUp className="h-4 w-4 stroke-[2.6]" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </ScrollArea>
            </>
          ) : (
            <>
              <header className="flex h-[70px] shrink-0 items-center border-b border-[#e4e7e8] px-5">
                <button
                  type="button"
                  onClick={() => setMediaPanelOpen(false)}
                  className="grid h-10 w-10 place-items-center rounded-full hover:bg-[#f0f2f5]"
                  aria-label="Volver"
                >
                  <ArrowLeft className="h-7 w-7" />
                </button>
              </header>
              <div className="grid h-[58px] shrink-0 grid-cols-3 border-b border-[#d1d7db] text-[15px]">
                {[
                  ["media", "Archivos multimedia"],
                  ["docs", "Documentos"],
                  ["links", "Enlaces"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setMediaPanelTab(value as typeof mediaPanelTab)}
                    className={`border-b-2 px-2 font-semibold ${
                      mediaPanelTab === value
                        ? "border-[#111b21] text-[#111b21]"
                        : "border-transparent text-[#667781] hover:bg-[#f5f6f6]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <ScrollArea className="flex-1">
                {mediaPanelTab === "media" ? (
                  <div className="px-6 py-6">
                    <div className="mb-4 text-[13px] font-bold uppercase text-[#111b21]">Este mes</div>
                    {mediaItems.length > 0 ? (
                      <div className="grid grid-cols-3 gap-3">
                        {mediaItems.map((msg) =>
                          isVideoMessage(msg) ? (
                            <a
                              key={msg.id}
                              href={msg.mediaUrl || "#"}
                              target="_blank"
                              rel="noreferrer"
                              className="aspect-square overflow-hidden rounded-md bg-[#f0f2f5]"
                            >
                              <VideoPreview src={msg.mediaUrl || ""} compact />
                            </a>
                          ) : (
                            <button
                              key={msg.id}
                              type="button"
                              onClick={() => setImagePreview({ src: msg.mediaUrl || "", alt: fileNameFromMessage(msg) })}
                              className="aspect-square cursor-zoom-in overflow-hidden rounded-md bg-[#f0f2f5]"
                              aria-label="Abrir imagen"
                            >
                              <img src={msg.mediaUrl || ""} alt="" className="h-full w-full object-cover" />
                            </button>
                          ),
                        )}
                      </div>
                    ) : (
                      <div className="rounded-xl bg-[#f7f8f8] px-4 py-8 text-center text-[14px] text-[#667781]">
                        Sin imágenes en este chat.
                      </div>
                    )}
                  </div>
                ) : null}
                {mediaPanelTab === "docs" ? (
                  <div className="space-y-4 px-6 py-6">
                    {documentItems.length > 0 ? (
                      documentItems.map((msg) => (
                        <div key={msg.id} className="border-b border-[#e9edef] pb-4">
                          <div className="rounded-xl bg-[#d9fdd3] p-2">
                            <DocumentPreview
                              name={fileNameFromMessage(msg)}
                              mimeType={msg.mediaMimeType}
                              href={msg.mediaUrl}
                            />
                            <div className="mt-1 flex justify-end gap-1 text-[11px] text-[#4d6f4a]">
                              {formatMessageTime(msg.timestamp)}
                              {msg.fromMe ? <CheckCheck className="h-3.5 w-3.5" /> : null}
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-xl bg-[#f7f8f8] px-4 py-8 text-center text-[14px] text-[#667781]">
                        Sin documentos en este chat.
                      </div>
                    )}
                  </div>
                ) : null}
                {mediaPanelTab === "links" ? (
                  <div className="space-y-3 px-6 py-6">
                    {linkItems.length > 0 ? (
                      linkItems.map((item) => (
                        <a
                          key={item.id}
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block overflow-hidden rounded-xl bg-[#d9fdd3] text-[#111b21]"
                        >
                          <div className="flex min-h-[82px]">
                            <div className="grid w-24 shrink-0 place-items-center bg-white/70 text-[#aebac1]">
                              <Link2 className="h-7 w-7" />
                            </div>
                            <div className="min-w-0 flex-1 px-3 py-2">
                              <div className="truncate text-[13px] font-bold">{item.url}</div>
                              <div className="mt-1 truncate text-[12px] text-[#667781]">{item.host}</div>
                            </div>
                          </div>
                          <div className="truncate px-3 pb-2 text-[13px]">{item.body}</div>
                        </a>
                      ))
                    ) : (
                      <div className="rounded-xl bg-[#f7f8f8] px-4 py-8 text-center text-[14px] text-[#667781]">
                        Sin enlaces en este chat.
                      </div>
                    )}
                  </div>
                ) : null}
              </ScrollArea>
              <div className="shrink-0 border-t border-[#e4e7e8] px-6 py-4 text-[15px] font-semibold text-[#008069]">
                Visualiza los archivos de todos los chats.
              </div>
            </>
          )}
        </aside>
      ) : null}
    </div>
  );
}
