import { useState, useEffect, useRef, useMemo, type Dispatch, type SetStateAction } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, isToday, isYesterday } from "date-fns";
import { useSocket } from "@/lib/socket-context";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Ban,
  Briefcase,
  Calendar,
  Camera,
  Check,
  CheckCheck,
  CheckSquare,
  ChevronDown,
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
type Collaborator = {
  id: number;
  username: string;
  displayName: string;
  role: "admin" | "user";
  permissions?: CollaboratorPermissions;
  createdAt: string;
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
type AgentResponseScope = "tagged" | "notTagged" | "all" | "exceptTagged";

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

const agentModelOptions = ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "Modelo personalizado"];

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
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
  mediaFileName?: string | null;
  quotedMessageId?: string | null;
  quotedBody?: string | null;
  quotedParticipant?: string | null;
  quotedFromMe?: boolean | null;
};

type MessageQuotePreview = {
  body: string;
  authorLabel: string;
  fromMe?: boolean | null;
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

function displayChatName(chat?: Pick<Chat, "name" | "id"> | null) {
  if (!chat) return "";
  return chat.name || chat.id.replace(/@c\.us|@g\.us|@lid|@s\.whatsapp\.net/g, "");
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
  chat?: Pick<Chat, "name" | "id" | "isGroup" | "phoneNumber" | "phoneCode" | "phoneCodeVerified"> | null,
) {
  if (!chat) return "";
  if (chat.isGroup) return displayChatName(chat);
  const digits = verifiedChatDigits(chat);
  return digits ? formatSixDigitCode(digits) : "Sin codigo verificado";
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

function formatMessageTime(timestamp?: number) {
  if (!timestamp) return "";
  return format(new Date(timestamp * 1000), "h:mm a").replace("AM", "a. m.").replace("PM", "p. m.");
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
          expiresAt: Date.now() + (url ? 60 * 60_000 : 90_000),
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
    <a href={href} target="_blank" rel="noreferrer" className="block">
      {content}
    </a>
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
  const seen = new Set(old.map((message) => message.id));
  const next = [...old];
  for (const message of list) {
    if (!message?.id || seen.has(message.id)) continue;
    seen.add(message.id);
    next.push(message);
  }
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
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  return res.json() as Promise<T>;
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
  size?: "sm" | "md" | "lg";
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
  const sizeClass = size === "sm" ? "h-12 w-12" : size === "lg" ? "h-28 w-28" : "h-14 w-14";
  const iconClass = size === "sm" ? "h-6 w-6" : size === "lg" ? "h-12 w-12" : "h-7 w-7";
  const showImage = !!resolvedImageUrl && !imageFailed;

  useEffect(() => {
    let cancelled = false;
    profilePicRetryRef.current = false;
    setResolvedImageUrl(imageUrl ?? null);
    setImageFailed(false);
    if (!imageUrl && profilePicLookupUrl) {
      void resolveProfilePicUrl(profilePicLookupUrl).then((url) => {
        if (!cancelled) setResolvedImageUrl(url);
      });
    }
    return () => {
      cancelled = true;
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
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  href?: string;
  tooltip: string;
  badge?: number;
  onClick?: () => void;
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-label={tooltip}
      className={`relative grid h-[38px] w-[38px] place-items-center rounded-full text-[#5f6f77] transition-colors hover:bg-[#e6eaed] hover:text-[#111b21] ${
        active ? "bg-[#e6eaed] text-[#111b21]" : ""
      }`}
    >
      {children}
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
  const [selectedLabelId, setSelectedLabelId] = useState<number | null>(null);
  const [labelMenuOpen, setLabelMenuOpen] = useState(false);
  const [appMenuOpen, setAppMenuOpen] = useState(false);
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [headerLabelsOpen, setHeaderLabelsOpen] = useState(false);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [leftPanel, setLeftPanel] = useState<"chats" | "labels" | "quickReplies" | "settings">("chats");
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
  const [agentEnabled, setAgentEnabled] = useState(false);
  const [agentOpenAiApiKey, setAgentOpenAiApiKey] = useState("");
  const [agentVoiceApiKey, setAgentVoiceApiKey] = useState("");
  const [agentModel, setAgentModel] = useState(agentModelOptions[0]);
  const [agentCustomModel, setAgentCustomModel] = useState("");
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
  const [agentTrainingText, setAgentTrainingText] = useState("");
  const [quickReplyDialogOpen, setQuickReplyDialogOpen] = useState(false);
  const [quickReplyShortcut, setQuickReplyShortcut] = useState("");
  const [quickReplyTitle, setQuickReplyTitle] = useState("");
  const [quickReplyBody, setQuickReplyBody] = useState("");
  const [collaboratorName, setCollaboratorName] = useState("");
  const [collaboratorEmail, setCollaboratorEmail] = useState("");
  const [collaboratorPassword, setCollaboratorPassword] = useState("");
  const [permissionTargetId, setPermissionTargetId] = useState<number | null>(null);
  const [permissionDraft, setPermissionDraft] = useState<CollaboratorPermissions>(
    DEFAULT_COLLABORATOR_PERMISSIONS,
  );
  const [noteBody, setNoteBody] = useState("");
  const [noteFiles, setNoteFiles] = useState<File[]>([]);
  const [isDraggingNoteFiles, setIsDraggingNoteFiles] = useState(false);
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
  const [hiddenMessageIds, setHiddenMessageIds] = useState<string[]>([]);
  const [messageQuotePreviews, setMessageQuotePreviews] = useState<Record<string, MessageQuotePreview>>({});
  const [detailsPanelOpen, setDetailsPanelOpen] = useState(false);
  const [mediaPanelOpen, setMediaPanelOpen] = useState(false);
  const [mediaPanelTab, setMediaPanelTab] = useState<"media" | "docs" | "links">("media");
  const { socket } = useSocket();
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "admin";
  const currentPermissions = useMemo(
    () => (isAdmin ? DEFAULT_COLLABORATOR_PERMISSIONS : normalizeCollaboratorPermissions(user?.permissions)),
    [isAdmin, user?.permissions],
  );
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageTextareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const noteFileInputRef = useRef<HTMLInputElement>(null);
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);
  const seenSocketMessageIdsRef = useRef<Set<string>>(new Set());

  const { data: devices } = useQuery({
    queryKey: ["devices"],
    queryFn: () => api<any[]>("/api/devices"),
    refetchInterval: 5_000,
  });

  const activeDevice = devices?.find((dev: any) => dev.sessionId === sessionId);
  const isDeviceReady = activeDevice?.status === "ready";

  const { data: chats, isLoading: isChatsLoading } = useQuery<Chat[]>({
    queryKey: ["chats", sessionId],
    queryFn: () => api<Chat[]>(`/api/devices/${sessionId}/chats`),
    enabled: !!sessionId && isDeviceReady,
    refetchInterval: 30_000,
  });

  const { data: labels } = useQuery<ChatLabel[]>({
    queryKey: ["labels"],
    queryFn: () => api<ChatLabel[]>("/api/labels"),
  });

  const { data: quickReplies } = useQuery<QuickReply[]>({
    queryKey: ["quick-replies"],
    queryFn: () => api<QuickReply[]>("/api/quick-replies"),
  });

  const { data: collaborators } = useQuery<Collaborator[]>({
    queryKey: ["collaborators"],
    queryFn: () => api<Collaborator[]>("/api/collaborators"),
    enabled: isAdmin,
  });

  const permissionTarget = collaborators?.find((collaborator) => collaborator.id === permissionTargetId);

  const { data: messages, isLoading: isMessagesLoading } = useQuery<Message[]>({
    queryKey: ["messages", sessionId, activeChatId],
    queryFn: () =>
      api<Message[]>(
        `/api/devices/${sessionId}/chats/${encodeURIComponent(activeChatId!)}/messages?limit=100`,
      ),
    enabled: !!sessionId && !!activeChatId,
  });

  const { data: chatNotes } = useQuery<ChatNote[]>({
    queryKey: ["chat-notes", sessionId, activeChatId],
    queryFn: () =>
      api<ChatNote[]>(
        `/api/devices/${sessionId}/chats/${encodeURIComponent(activeChatId!)}/notes`,
      ),
    enabled: !!sessionId && !!activeChatId && detailsPanelOpen,
  });

	  const sendMessage = useMutation({
	    mutationFn: async ({ body, quotedMessageId }: { body: string; quotedMessageId?: string }) =>
	      api<Message>(
        `/api/devices/${sessionId}/chats/${encodeURIComponent(activeChatId!)}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body, quotedMessageId }),
        },
      ),
	    onSuccess: (newMsg, variables) => {
	      queryClient.setQueryData<Message[]>(["messages", sessionId, activeChatId], (old = []) =>
	        appendUniqueMessages(old, newMsg),
	      );
	      if (variables.quotedMessageId && replyToMessage) {
	        setMessageQuotePreviews((current) => ({
	          ...current,
	          [newMsg.id]: {
	            body: messageActionText(replyToMessage),
	            authorLabel: replyToMessage.fromMe ? "Tú" : activeChatName || "Contacto",
	            fromMe: replyToMessage.fromMe,
	          },
	        }));
	      }
	      setMessageInput("");
	      setReplyToMessage(null);
	    },
	    onError: (err) => toast.error((err as Error).message),
	  });

	  const forwardMessageToChat = useMutation({
	    mutationFn: async ({ chatId, body }: { chatId: string; body: string }) =>
	      api<Message>(
	        `/api/devices/${sessionId}/chats/${encodeURIComponent(chatId)}/messages`,
	        {
	          method: "POST",
	          headers: { "Content-Type": "application/json" },
	          body: JSON.stringify({ body }),
	        },
	      ),
	    onSuccess: (_, variables) => {
	      setForwardMessage(null);
	      setForwardSearchQuery("");
	      void queryClient.invalidateQueries({ queryKey: ["chats", sessionId] });
	      void queryClient.invalidateQueries({ queryKey: ["messages", sessionId, variables.chatId] });
	      toast.success("Mensaje reenviado");
	    },
	    onError: (err) => toast.error((err as Error).message),
	  });

  const sendMediaFiles = useMutation({
    mutationFn: async ({ files, caption }: { files: File[]; caption: string }) => {
      if (!currentPermissions.canSendMedia) {
        throw new Error("No tienes permiso para enviar archivos");
      }
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      if (caption.trim()) formData.append("caption", caption.trim());
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
      void queryClient.invalidateQueries({ queryKey: ["messages", sessionId, activeChatId] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const createQuickReply = useMutation({
    mutationFn: async () => {
      if (!currentPermissions.canManageQuickReplies) {
        throw new Error("No tienes permiso para administrar respuestas rápidas");
      }
      const formData = new FormData();
      formData.append("shortcut", quickReplyShortcut.trim());
      formData.append("title", quickReplyTitle.trim());
      formData.append("body", quickReplyBody);
      return api<QuickReply>("/api/quick-replies", { method: "POST", body: formData });
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
        }),
      }),
    onSuccess: () => {
      setCollaboratorName("");
      setCollaboratorEmail("");
      setCollaboratorPassword("");
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
    setIsDraggingFiles(false);
    setMediaPanelOpen(false);
    setOpenMessageMenuId(null);
    setReplyToMessage(null);
    setForwardMessage(null);
    setMessageInfo(null);
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

      queryClient.setQueryData<Chat[]>(["chats", sessionId], (old) => {
        if (!old) return old;
        let matched = false;
        const incomingUnread = !data.fromMe && data.chatId !== activeChatId ? 1 : 0;
        const next = old.map((chat) => {
          if (chat.id !== data.chatId) return chat;
          matched = true;
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
        return matched ? next : old;
      });

      if (data.chatId === activeChatId) {
        queryClient.setQueryData<Message[]>(["messages", sessionId, activeChatId], (old = []) =>
          appendUniqueMessages(old, data),
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["chats", sessionId] });
    };
    socket.on("message", handleMessage);
    return () => {
      socket.off("message", handleMessage);
    };
  }, [socket, sessionId, activeChatId, queryClient]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

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
      if (event.key === "Escape") setAgentPanelOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [agentPanelOpen]);

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

	  const addPendingFiles = (files: FileList | File[]) => {
	    if (!activeChatId) {
	      toast.info("Selecciona un chat primero.");
	      return;
	    }
	    if (activeChatBlockedByUnverifiedCode) {
	      toast.error("Codigo no verificado por WhatsApp. No se puede enviar desde el CRM.");
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

	  const toggleMessageFlag = (
	    setter: Dispatch<SetStateAction<string[]>>,
	    messageId: string,
	  ) => {
	    setter((current) =>
	      current.includes(messageId)
	        ? current.filter((id) => id !== messageId)
	        : [...current, messageId],
	    );
	  };

		  const copyMessageText = (msg: Message) => {
		    const text = messageActionText(msg);
		    void navigator.clipboard?.writeText(text)
		      .then(() => toast.success("Mensaje copiado"))
		      .catch(() => toast.error("No se pudo copiar el mensaje"));
		    setOpenMessageMenuId(null);
		  };

		  const downloadMessageMedia = (msg: Message) => {
		    const href = msg.mediaUrl || (msg.body?.startsWith("data:") ? msg.body : "");
		    if (!href) {
		      toast.info("Este mensaje no tiene archivo descargable.");
		      setOpenMessageMenuId(null);
		      return;
		    }
		    const link = document.createElement("a");
		    link.href = href;
		    link.download = fileNameFromMessage(msg);
		    link.rel = "noopener";
		    document.body.appendChild(link);
		    link.click();
		    link.remove();
		    setOpenMessageMenuId(null);
		  };

	  const addReactionToMessage = (msg: Message, reaction: string) => {
	    setMessageReactions((current) => ({ ...current, [msg.id]: reaction }));
	    setOpenMessageMenuId(null);
	  };

	  const deleteMessageLocally = (msg: Message) => {
	    setHiddenMessageIds((current) => (current.includes(msg.id) ? current : [...current, msg.id]));
	    setOpenMessageMenuId(null);
	    toast.success("Mensaje eliminado de esta vista");
	  };

	  const startForwardMessage = (msg: Message) => {
	    setForwardMessage(msg);
	    setForwardSearchQuery("");
	    setOpenMessageMenuId(null);
	  };

	  const handleSend = (e?: { preventDefault: () => void }) => {
    e?.preventDefault();
    if (!activeChatId) return;
	    if (!currentPermissions.canReply) {
	      toast.error("No tienes permiso para responder mensajes");
	      return;
	    }
	    if (activeChatBlockedByUnverifiedCode) {
	      toast.error("Codigo no verificado por WhatsApp. No se puede responder desde el CRM.");
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
		    sendMessage.mutate({ body: outgoingBody, quotedMessageId: replyToMessage?.id });
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
  const selectedLabel = labels?.find((label) => label.id === selectedLabelId) ?? null;
  const agentSelectedLabels = labels?.filter((label) => agentSelectedLabelIds.includes(label.id)) ?? [];

  const toggleAgentLabel = (labelId: number) => {
    setAgentSelectedLabelIds((current) =>
      current.includes(labelId) ? current.filter((id) => id !== labelId) : [...current, labelId],
    );
  };

  const toggleAgentTraining = (key: AgentTrainingKind) => {
    setAgentTrainingEnabled((current) => ({ ...current, [key]: !current[key] }));
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

	  const archivedCount = chats?.filter((c) => c.archived).length ?? 0;
	  const activeChat = chats?.find((c) => c.id === activeChatId);
	  const activeChatBlockedByUnverifiedCode = !!activeChat && !activeChat.isGroup && !verifiedChatDigits(activeChat);
	  const activeChatName = displayChatCode(activeChat);
	  const activeChatFullName = displayChatName(activeChat);
	  const headerLabel = activeChat?.labels?.[0] ?? null;
	  const activeMessages = useMemo(
	    () => (messages ?? []).filter((message) => !hiddenMessageIds.includes(message.id)),
	    [messages, hiddenMessageIds],
	  );
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
  const participantDigitsById = useMemo(() => {
    const byId = new Map<string, string>();
    activeChat?.participants?.forEach((participant) => {
      const digits = verifiedParticipantDigits(participant);
      if (digits) byId.set(participant.id, digits);
    });
    return byId;
  }, [activeChat]);
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

    activeChat.participants?.forEach((participant) =>
      addVerifiedMember(participant.id, verifiedParticipantDigits(participant)),
    );
    activeMessages.forEach((message) => {
      const authorDigits = (message.author ? participantDigitsById.get(message.author) : "") || trustedDigitsFromWaId(message.author);
      if (message.author && authorDigits) addVerifiedMember(message.author, authorDigits);
    });

    return Array.from(byCode.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [activeChat, activeMessages, chats, participantDigitsById]);
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
	    { key: "restrict", label: "Restringir chat", icon: <Briefcase className={menuIconClass} /> },
	    { key: "close", label: "Cerrar chat", icon: <XCircle className={menuIconClass} /> },
	  ];

  const handleChatMenuAction = (key: string) => {
    setChatMenuOpen(false);
    if (key === "info") {
      setDetailsPanelOpen(true);
      setMediaPanelOpen(false);
      return;
    }
    if (key === "search") {
      toast.info("Búsqueda dentro del chat en preparación.");
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
    if (key === "restrict") {
      toast.info("Restricción disponible desde WhatsApp.");
      return;
    }
    if (key === "close") {
      setActiveChatId(null);
    }
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
        <div className="mt-auto flex flex-col items-center gap-2">
          <RailButton
            active={agentPanelOpen}
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
                      <input
                        value={collaboratorName}
                        onChange={(event) => setCollaboratorName(event.target.value)}
                        placeholder="Nombre"
                        className="h-11 w-full rounded-lg border border-[#d1d7db] px-3 text-[15px] outline-none focus:border-[#00a884]"
                      />
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
                          <span className="block truncate text-[15px] font-semibold">{collaborator.displayName}</span>
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
                <div key={i} className="flex h-[68px] items-center gap-3 rounded-xl px-3">
                  <div className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-[#eef0f2]" />
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
                const visibleName = displayChatCode(chat);

                return (
                  <ContextMenu key={chat.id}>
                    <ContextMenuTrigger asChild>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveChatId(chat.id);
                          closeMenus(setLabelMenuOpen, setAppMenuOpen, setChatMenuOpen, setHeaderLabelsOpen, setAttachmentMenuOpen, setEmojiOpen, setQuickReplyOpen);
                        }}
                        className={`group grid w-full min-w-0 max-w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 overflow-hidden rounded-lg px-3 py-2.5 text-left transition-colors ${
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
                          size="sm"
                        />
                        <div className="min-w-0">
                          <div className="mb-0.5 flex items-center gap-2">
                            <span className={`truncate text-[16px] leading-6 text-[#111b21] ${hasUnread ? "font-bold" : "font-semibold"}`}>
                              {visibleName}
                            </span>
                            {firstLabel ? (
                              <Folder
                                className="h-4 w-4 shrink-0 fill-current"
                                style={{ color: labelColor(firstLabel) }}
                              />
                            ) : null}
                            {chat.favorited ? (
                              <Star className="h-4 w-4 shrink-0 fill-[#f5bd31] text-[#f5bd31]" />
                            ) : null}
                            {chat.muted ? (
                              <VolumeX className="h-4 w-4 shrink-0 text-[#667781]" />
                            ) : null}
                          </div>
                          <div className={`flex min-w-0 items-center gap-1 text-[13px] leading-5 ${hasUnread ? "font-semibold text-[#111b21]" : "text-[#667781]"}`}>
                            {chat.pinned ? <Pin className="h-4 w-4 shrink-0" /> : null}
                            {fromMe ? <CheckCheck className="h-4 w-4 shrink-0 text-[#667781]" /> : null}
                            <span className="truncate">{preview}</span>
                          </div>
                        </div>
                        <div className="flex w-[72px] shrink-0 flex-col items-end gap-1 self-stretch py-0.5">
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
                            <ChevronDown className="h-4 w-4 text-[#667781] opacity-0 transition-opacity group-hover:opacity-100" />
                          </div>
                        </div>
                      </button>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-60">
                      <ContextMenuItem
                        onSelect={() =>
                          mutateChatState.mutate({ chat, patch: { manuallyUnread: true } })
                        }
                      >
                        <MailPlus className="mr-2 h-4 w-4" /> Marcar como no leído
                      </ContextMenuItem>
                      <ContextMenuItem
                        onSelect={() =>
                          mutateChatState.mutate({
                            chat,
                            patch: { archived: !chat.archived },
                          })
                        }
                      >
                        {chat.archived ? (
                          <>
                            <ArchiveRestore className="mr-2 h-4 w-4" /> Desarchivar
                          </>
                        ) : (
                          <>
                            <Archive className="mr-2 h-4 w-4" /> Archivar
                          </>
                        )}
                      </ContextMenuItem>
                      <ContextMenuItem onSelect={() => toast.info("Restricción preparada para este chat.")}>
                        <Briefcase className="mr-2 h-4 w-4" /> Restringir chat
                      </ContextMenuItem>
                      <ContextMenuItem
                        onSelect={() =>
                          mutateChatState.mutate({
                            chat,
                            patch: { muted: !chat.muted },
                          })
                        }
                      >
                        <VolumeX className={`mr-2 h-4 w-4 ${chat.muted ? "text-[#008069]" : ""}`} />
                        {chat.muted ? "Reactivar notificaciones" : "Silenciar notificaciones"}
                      </ContextMenuItem>
                      <ContextMenuItem
                        onSelect={() =>
                          mutateChatState.mutate({
                            chat,
                            patch: { pinned: !chat.pinned },
                          })
                        }
                      >
                        <Pin className="mr-2 h-4 w-4" /> {chat.pinned ? "Desfijar chat" : "Fijar chat"}
                      </ContextMenuItem>
                      <ContextMenuItem
                        onSelect={() =>
                          mutateChatState.mutate({
                            chat,
                            patch: { favorited: !chat.favorited },
                          })
                        }
                      >
                        <Star
                          className={`mr-2 h-4 w-4 ${chat.favorited ? "fill-amber-400 text-amber-400" : ""}`}
                        />
                        {chat.favorited ? "Quitar destacado" : "Destacar"}
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuSub>
                        <ContextMenuSubTrigger>
                          <Tag className="mr-2 h-4 w-4" /> Etiquetas
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent className="w-56">
                          {labels && labels.length > 0 ? (
                            labels.map((l) => (
                              <ContextMenuItem
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
                                <span
                                  className="inline-block h-3 w-3 rounded-sm"
                                  style={{ backgroundColor: l.color }}
                                />
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
                              </ContextMenuItem>
                            ))
                          ) : (
                            <ContextMenuItem disabled>
                              Sin etiquetas -{" "}
                              <Link href="/labels" className="ml-1 underline">
                                crear
                              </Link>
                            </ContextMenuItem>
                          )}
                          <ContextMenuSeparator />
                          <Link href="/labels">
                            <ContextMenuItem>
                              <Tags className="mr-2 h-4 w-4" /> Gestionar etiquetas
                            </ContextMenuItem>
                          </Link>
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                      <ContextMenuSeparator />
                      <ContextMenuItem onSelect={() => toast.info("Bloqueo disponible desde WhatsApp.")}>
                        <Ban className="mr-2 h-4 w-4" /> Bloquear
                      </ContextMenuItem>
                      <ContextMenuItem onSelect={() => toast.info("Vaciar chat no borra mensajes en WhatsApp desde este panel.")}>
                        <Eraser className="mr-2 h-4 w-4" /> Vaciar chat
                      </ContextMenuItem>
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
        className="wa-chat-bg relative flex min-w-0 flex-1 flex-col bg-[#f6f7f4]"
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
          </div>
        ) : (
          <>
            <header className="relative z-10 flex h-[70px] shrink-0 items-center border-b border-[#e4e7e8] bg-white px-5">
              <button
                type="button"
                onClick={() => {
                  setDetailsPanelOpen(true);
                  setMediaPanelOpen(false);
                  closeMenus(setChatMenuOpen, setHeaderLabelsOpen, setAttachmentMenuOpen, setEmojiOpen, setQuickReplyOpen);
                }}
                className="flex min-w-0 flex-1 items-center rounded-xl py-1 pr-3 text-left hover:bg-[#f7f8f8]"
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
                  {activeChat?.muted ? (
                    <VolumeX className="h-4 w-4 shrink-0 text-[#667781]" aria-label="Notificaciones silenciadas" />
                  ) : null}
                </div>
              </button>
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
                <button className="flex h-10 items-center gap-2 rounded-full border border-[#d1d7db] bg-white px-4 hover:bg-[#f5f6f6]">
                  <Video className="h-6 w-6" />
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button className="grid h-10 w-10 place-items-center rounded-full hover:bg-[#f0f2f5]" aria-label="Buscar">
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
                  className="fixed inset-0 z-40 cursor-default bg-transparent"
                  onClick={() => setHeaderLabelsOpen(false)}
                />
                <div className="absolute right-[260px] top-[56px] z-50 w-[305px] rounded-2xl border border-[#e1e4e6] bg-white py-3 shadow-[0_8px_28px_rgba(11,20,26,0.18)]">
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
                    className="fixed inset-0 z-40 cursor-default bg-transparent"
                    onClick={() => setChatMenuOpen(false)}
                  />
                <div className="absolute right-3 top-[58px] z-50 w-[292px] overflow-hidden rounded-xl border border-[#e8ecef] bg-white py-1.5 shadow-[0_12px_32px_rgba(11,20,26,0.14)]">
                  {chatMenuItems.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => handleChatMenuAction(item.key)}
                      className="flex min-h-10 w-full items-center gap-3 px-4 text-left text-[14px] font-medium text-[#111b21] hover:bg-[#f7f8f8]"
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </button>
                  ))}
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

            <ScrollArea className="relative z-10 flex-1">
              <div className="mx-auto flex w-full max-w-[940px] flex-col gap-1.5 px-8 py-6">
                <div className="my-2 self-center rounded-lg bg-white px-4 py-1.5 text-[13px] font-semibold text-[#667781] shadow-sm">
                  Hoy
                </div>
                {isMessagesLoading ? (
                  <div className="self-center rounded-lg bg-white/90 px-4 py-3 text-[#667781] shadow-sm">
                    Cargando mensajes...
                  </div>
	                ) : activeMessages.length === 0 ? (
                  <div className="self-center rounded-lg bg-[#fff5c4] px-4 py-3 text-sm text-[#5f5500] shadow-sm">
                    Envía un mensaje para iniciar.
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
                    const visualOnly = !!(imageSrc || videoSrc) && !body;
	                    const visualMedia = !!(imageSrc || videoSrc);
	                    const messageTime = formatMessageTime(msg.timestamp);
	                    const authorCode = (msg.author ? participantDigitsById.get(msg.author) : "") || trustedDigitsFromWaId(msg.author);
		                    const messageReaction = messageReactions[msg.id];
		                    const messagePinned = pinnedMessageIds.includes(msg.id);
		                    const messageStarred = starredMessageIds.includes(msg.id);
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
	                        className={`group/message relative flex max-w-[74%] flex-col ${msg.fromMe ? "self-end items-end" : "self-start items-start"}`}
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
		                                "right-0"
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
	                                  onClick: () => {
	                                    setMessageInfo(msg);
	                                    setOpenMessageMenuId(null);
	                                  },
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
		                                ...(msg.mediaUrl || msg.body?.startsWith("data:")
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
	                                    toggleMessageFlag(setPinnedMessageIds, msg.id);
	                                    setOpenMessageMenuId(null);
	                                  },
	                                },
	                                {
	                                  key: "star",
	                                  label: messageStarred ? "Quitar destacado" : "Destacar",
	                                  icon: <Star className="h-4 w-4" />,
	                                  onClick: () => {
	                                    toggleMessageFlag(setStarredMessageIds, msg.id);
	                                    setOpenMessageMenuId(null);
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
                            <div className={`whitespace-pre-wrap break-words ${visualMedia ? "px-1.5 pb-0.5 pt-1 text-[17px]" : ""}`}>
                              {body}
                            </div>
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
                <div className="mx-auto mb-3 max-h-56 max-w-[1320px] overflow-y-auto rounded-xl border border-[#d1d7db] bg-white shadow-lg">
                  {quickReplies && quickReplies.length > 0 ? (
                    quickReplies.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => sendQuickReply.mutate(r.id)}
                        className="flex w-full items-center gap-3 border-b border-[#f0f2f5] px-4 py-3 text-left hover:bg-[#f5f6f6]"
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
                      No tienes respuestas rápidas.{" "}
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
	              {activeChatBlockedByUnverifiedCode ? (
	                <div className="mx-auto mb-3 max-w-[1320px] rounded-xl border border-[#f0b3b3] bg-[#fff4f4] px-4 py-3 text-[13px] font-semibold text-[#b42318]">
	                  Codigo no verificado por WhatsApp. No se puede responder desde el CRM.
	                </div>
	              ) : null}
	              <form onSubmit={handleSend} className="mx-auto flex max-w-[1320px] items-end gap-3">
	                <button
	                  type="button"
	                  onClick={() => {
	                    if (activeChatBlockedByUnverifiedCode) {
	                      toast.error("Codigo no verificado por WhatsApp. No se puede enviar desde el CRM.");
	                      return;
	                    }
	                    if (!currentPermissions.canSendMedia && !currentPermissions.canUseQuickReplies) {
	                      toast.error("No tienes permiso para enviar adjuntos");
	                      return;
                    }
                    setAttachmentMenuOpen((v) => !v);
	                    closeMenus(setLabelMenuOpen, setAppMenuOpen, setChatMenuOpen, setHeaderLabelsOpen, setEmojiOpen, setQuickReplyOpen);
	                  }}
	                  disabled={activeChatBlockedByUnverifiedCode || (!currentPermissions.canSendMedia && !currentPermissions.canUseQuickReplies)}
	                  className={`grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-[#111b21] shadow-sm hover:bg-[#f5f6f6] ${
	                    attachmentMenuOpen ? "text-[#008069]" : ""
	                  } disabled:cursor-not-allowed disabled:opacity-45`}
                  aria-label="Abrir adjuntos"
                >
                  <Plus className="h-7 w-7" />
                </button>
                <div className="flex min-h-[56px] flex-1 items-center rounded-[28px] bg-white px-5 shadow-sm">
                  <button
                    type="button"
                    onClick={() => {
                      setEmojiOpen((v) => !v);
                      closeMenus(setLabelMenuOpen, setAppMenuOpen, setChatMenuOpen, setHeaderLabelsOpen, setAttachmentMenuOpen, setQuickReplyOpen);
                    }}
                    className={`mr-4 grid h-9 w-9 shrink-0 place-items-center rounded-full hover:bg-[#f5f6f6] ${
                      emojiOpen ? "text-[#008069]" : "text-[#111b21]"
                    }`}
                    aria-label="Abrir emojis"
                  >
                    <Smile className="h-7 w-7" />
                  </button>
	                  <textarea
	                    ref={messageTextareaRef}
	                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend(e);
                      }
                    }}
	                    disabled={activeChatBlockedByUnverifiedCode || !currentPermissions.canReply}
	                    placeholder={
	                      activeChatBlockedByUnverifiedCode
	                        ? "Codigo no verificado"
	                        : currentPermissions.canReply
	                          ? "Escribe un mensaje"
	                          : "Sin permiso para responder"
	                    }
	                    className="h-7 max-h-32 min-h-7 w-full resize-none bg-transparent text-[18px] leading-7 text-[#111b21] outline-none placeholder:text-[#7a7f83]"
	                    rows={1}
	                  />
                </div>
                <Button
                  type="submit"
                  size="icon"
	                  disabled={sendMessage.isPending || sendMediaFiles.isPending || activeChatBlockedByUnverifiedCode || !currentPermissions.canReply}
                  className={`h-12 w-12 shrink-0 rounded-full shadow-sm disabled:opacity-60 ${
                    messageInput.trim() || pendingFiles.length > 0
                      ? "bg-[#111b21] text-white hover:bg-[#222e35]"
                      : "bg-white text-[#111b21] hover:bg-[#f5f6f6]"
                  }`}
                  aria-label={messageInput.trim() || pendingFiles.length > 0 ? "Enviar" : "Mensaje de voz"}
                >
                  {messageInput.trim() || pendingFiles.length > 0 ? (
                    <Send className="h-6 w-6" />
                  ) : (
                    <Mic className="h-7 w-7" />
                  )}
                </Button>
              </form>
            </footer>
          </>
        )}
      </main>
      {agentPanelOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[#111b21]/45 px-4 py-6 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-label="Agente IA"
          onClick={() => setAgentPanelOpen(false)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="flex max-h-[88vh] w-full max-w-[980px] flex-col overflow-hidden rounded-[22px] bg-white shadow-[0_28px_90px_rgba(11,20,26,0.38)]"
          >
            <header className="flex h-[64px] shrink-0 items-center gap-3 border-b border-[#e4e7e8] px-5">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#e5f6ef] text-[25px]">
                🙋
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[19px] font-semibold text-[#111b21]">Agente IA</h2>
                <p className="truncate text-[12px] font-semibold text-[#667781]">
                  {agentEnabled ? "Activo para responder clientes" : "Pausado"}
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
              className={`grid min-h-0 flex-1 grid-cols-1 overflow-hidden ${
                agentSettingsOpen ? "lg:grid-cols-[minmax(0,1fr)_320px]" : ""
              }`}
            >
              <ScrollArea className="min-h-0">
                <div className="space-y-5 p-5">
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
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {agentTrainingCards.map((card) => (
                        <div key={card.key} className="flex min-h-[228px] flex-col rounded-xl border border-[#e4e7e8] bg-white p-4 shadow-sm">
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
                            <textarea
                              value={agentTrainingText}
                              onChange={(event) => setAgentTrainingText(event.target.value)}
                              placeholder="Escribe reglas, tono y respuestas frecuentes."
                              className="min-h-[88px] flex-1 resize-none rounded-lg border border-[#d1d7db] px-3 py-2 text-[13px] leading-5 outline-none focus:border-[#008069]"
                            />
                          ) : (
                            <label className="grid min-h-[88px] flex-1 cursor-pointer place-items-center rounded-lg border border-dashed border-[#cfd8dc] bg-[#fbfbfa] px-3 py-4 text-center text-[13px] font-semibold text-[#54656f] hover:bg-[#f5f6f6]">
                              <input type="file" className="hidden" accept={card.accept} multiple />
                              Cargar {card.title.toLowerCase()}
                            </label>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-xl border border-[#dce3df] bg-[#fbfbfa] p-4">
                    <h3 className="text-[16px] font-semibold text-[#111b21]">Flujo de voz</h3>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      {[
                        "Recibir audio",
                        agentAudioToText ? "Transcribir a texto" : "Omitir transcripción",
                        agentVoiceReplies ? "Responder en voz o texto" : "Responder solo texto",
                      ].map((step, index) => (
                        <div key={step} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-[13px] font-semibold text-[#111b21]">
                          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#e5f6ef] text-[12px] text-[#008069]">
                            {index + 1}
                          </span>
                          <span className="min-w-0 truncate">{step}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              </ScrollArea>

              <aside className={`${agentSettingsOpen ? "flex" : "hidden"} min-h-0 flex-col border-l border-[#e4e7e8] bg-[#f7f8f8]`}>
                <div className="shrink-0 border-b border-[#e4e7e8] px-4 py-4">
                  <div className="flex items-center gap-2 text-[16px] font-semibold text-[#111b21]">
                    <Settings className="h-4 w-4" />
                    Configuración
                  </div>
                  <div className="mt-1 text-[12px] leading-5 text-[#667781]">
                    Reglas para elegir qué chats atiende el agente.
                  </div>
                </div>
                <ScrollArea className="min-h-0 flex-1">
                  <div className="space-y-3 p-4">
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

            <footer className="grid shrink-0 gap-3 border-t border-[#e4e7e8] bg-white px-5 py-4 md:grid-cols-[minmax(0,1fr)_220px_220px_auto_auto]">
              <label className="min-w-0">
                <span className="mb-1 block text-[12px] font-semibold text-[#54656f]">API de OpenAI</span>
                <input
                  value={agentOpenAiApiKey}
                  onChange={(event) => setAgentOpenAiApiKey(event.target.value)}
                  type="password"
                  placeholder="sk-..."
                  className="h-10 w-full rounded-lg border border-[#d1d7db] px-3 text-[13px] outline-none focus:border-[#008069]"
                />
              </label>
              <label className="min-w-0">
                <span className="mb-1 block text-[12px] font-semibold text-[#54656f]">Modelo</span>
                <select
                  value={agentModel}
                  onChange={(event) => setAgentModel(event.target.value)}
                  className="h-10 w-full rounded-lg border border-[#d1d7db] bg-white px-3 text-[13px] outline-none focus:border-[#008069]"
                >
                  {agentModelOptions.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-0">
                <span className="mb-1 block text-[12px] font-semibold text-[#54656f]">
                  {agentModel === "Modelo personalizado" ? "Nombre del modelo" : "API de voz"}
                </span>
                <input
                  value={agentModel === "Modelo personalizado" ? agentCustomModel : agentVoiceApiKey}
                  onChange={(event) =>
                    agentModel === "Modelo personalizado"
                      ? setAgentCustomModel(event.target.value)
                      : setAgentVoiceApiKey(event.target.value)
                  }
                  type={agentModel === "Modelo personalizado" ? "text" : "password"}
                  placeholder={agentModel === "Modelo personalizado" ? "modelo" : "voz..."}
                  className="h-10 w-full rounded-lg border border-[#d1d7db] px-3 text-[13px] outline-none focus:border-[#008069]"
                />
              </label>
              <button
                type="button"
                onClick={() => setAgentSettingsOpen(true)}
                className="h-10 rounded-lg border border-[#d1d7db] px-4 text-[13px] font-semibold text-[#54656f] hover:bg-[#f5f6f6]"
              >
                Siguiente
              </button>
              <button
                type="button"
                onClick={() => toast.success("Configuración del agente guardada")}
                className="h-10 rounded-lg bg-[#008069] px-4 text-[13px] font-semibold text-white hover:bg-[#027a62]"
              >
                Guardar
              </button>
            </footer>
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
                    const targetBlocked = !chat.isGroup && !verifiedChatDigits(chat);
                    const targetLabel = displayChatCode(chat);
                    const targetName = displayChatName(chat);
                    return (
                      <button
                        key={chat.id}
                        type="button"
                        disabled={targetBlocked || forwardMessageToChat.isPending || !currentPermissions.canReply}
                        onClick={() => {
                          const body = `Reenviado\n${messageActionText(forwardMessage)}`.slice(0, 3900);
                          if (containsBlockedPhoneNumber(body)) {
                            toast.error(blockedPhoneNumberMessage);
                            return;
                          }
                          forwardMessageToChat.mutate({ chatId: chat.id, body });
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
                          <div className="truncate text-[12px] text-[#667781]">
                            {targetBlocked ? "Codigo no verificado" : targetName}
                          </div>
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
                <div className="whitespace-pre-wrap break-words">{messageActionText(messageInfo)}</div>
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
              </div>
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
                    className={`mt-3 rounded-xl border border-dashed p-3 text-left transition-colors ${
                      isDraggingNoteFiles
                        ? "border-[#008069] bg-[#e5f6ef]"
                        : "border-[#d9dee1] bg-[#fbfbfb]"
                    }`}
                  >
                    <textarea
                      ref={noteTextareaRef}
                      value={noteBody}
                      onChange={(event) => setNoteBody(event.target.value)}
                      rows={2}
                      maxLength={4000}
                      placeholder="Arrastra fotos, videos o documentos aqui"
                      className="w-full resize-none rounded-lg border border-[#d1d7db] bg-white px-3 py-2 text-[12px] leading-5 text-[#111b21] outline-none focus:border-[#008069]"
                    />
                    <input
                      ref={noteFileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(event) => addNoteFiles(event.target.files ?? [])}
                    />
                    {noteFiles.length > 0 ? (
                      <div className="mt-2 space-y-1.5">
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
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => noteFileInputRef.current?.click()}
                        className="rounded-full px-3 py-1.5 text-[12px] font-semibold text-[#54656f] hover:bg-[#eef0f2]"
                      >
                        Adjuntar
                      </button>
                      <button
                        type="button"
                        disabled={createChatNote.isPending || (!noteBody.trim() && noteFiles.length === 0)}
                        onClick={() => createChatNote.mutate()}
                        className="rounded-full bg-[#008069] px-3 py-1.5 text-[12px] font-semibold text-white disabled:bg-[#d8dee2] disabled:text-[#8696a0]"
                      >
                        Guardar
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
