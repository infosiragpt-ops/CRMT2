import { useState, useEffect, useRef, useMemo } from "react";
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
  Download,
  Eraser,
  File as FileIcon,
  FileText,
  Flag,
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
type ChatParticipant = { id: string; name?: string | null; isAdmin?: boolean };
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
  manuallyUnread: boolean;
  labels: ChatLabel[];
  profilePicUrl?: string | null;
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

function compactCode(value: string) {
  return digitsFromText(value).slice(-6);
}

function displayChatCode(chat?: Pick<Chat, "name" | "id" | "isGroup"> | null) {
  if (!chat) return "";
  if (chat.isGroup) return displayChatName(chat);
  const nameDigits = digitsFromText(chat.name);
  if (nameDigits.length >= 6) return formatSixDigitCode(nameDigits);
  const idDigits = digitsFromText(chat.id);
  if (idDigits.length >= 6) return formatSixDigitCode(idDigits);
  return displayChatName(chat);
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

function fileNameFromMessage(msg: Message) {
  if (msg.mediaFileName) return msg.mediaFileName;
  const body = sanitizePreview(msg.body || "");
  if (/\.[a-z0-9]{2,6}$/i.test(body)) return body;
  if (msg.type === "image" || msg.mediaMimeType?.startsWith("image/")) return "Foto";
  if (msg.type === "video" || msg.mediaMimeType?.startsWith("video/")) return "Video";
  if (msg.type === "audio" || msg.mediaMimeType?.startsWith("audio/")) return "Audio";
  return "Documento";
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
  size = "md",
}: {
  name: string;
  isGroup?: boolean;
  selected?: boolean;
  imageSeed?: number;
  imageUrl?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const palettes = [
    "bg-[#d9d0f6] text-[#6650ca]",
    "bg-[#d3e6ff] text-[#0b65c2]",
    "bg-[#f8d9cb] text-[#b45a42]",
    "bg-[#d8efe1] text-[#1f8c5d]",
  ];
  const palette = palettes[imageSeed ? imageSeed % palettes.length : 0];
  const sizeClass = size === "sm" ? "h-12 w-12" : size === "lg" ? "h-28 w-28" : "h-14 w-14";
  const iconClass = size === "sm" ? "h-6 w-6" : size === "lg" ? "h-12 w-12" : "h-7 w-7";
  const showImage = !!imageUrl && !imageFailed;

  useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);

  return (
    <div
      className={`relative grid ${sizeClass} shrink-0 place-items-center overflow-hidden rounded-full border ${
        selected ? "border-[#d9d9d9]" : "border-transparent"
      } ${palette}`}
    >
      {showImage ? (
        <img
          src={imageUrl}
          alt={name ? `Foto de ${name}` : "Foto de contacto"}
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const seenSocketMessageIdsRef = useRef<Set<string>>(new Set());

  const { data: devices } = useQuery({
    queryKey: ["devices"],
    queryFn: () => api<any[]>("/api/devices"),
  });

  const activeDevice = devices?.find((dev: any) => dev.sessionId === sessionId);

  const { data: chats, isLoading: isChatsLoading } = useQuery<Chat[]>({
    queryKey: ["chats", sessionId],
    queryFn: () => api<Chat[]>(`/api/devices/${sessionId}/chats`),
    enabled: !!sessionId,
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

  const sendMessage = useMutation({
    mutationFn: async (body: string) =>
      api<Message>(
        `/api/devices/${sessionId}/chats/${encodeURIComponent(activeChatId!)}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
        },
      ),
    onSuccess: (newMsg) => {
      queryClient.setQueryData<Message[]>(["messages", sessionId, activeChatId], (old = []) =>
        appendUniqueMessages(old, newMsg),
      );
      setMessageInput("");
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["chats", sessionId] }),
    onError: (err) => toast.error((err as Error).message),
  });

  const toggleLabelOnChat = useMutation({
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["chats", sessionId] }),
    onError: (err) => toast.error((err as Error).message),
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
      const muted = isChatMuted(queryClient.getQueryData<Chat[]>(["chats", sessionId]), data.chatId);
      if (!data.fromMe && !muted) playIncomingMessageSound();

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
    if (pendingFiles.length > 0) {
      if (!currentPermissions.canSendMedia) {
        toast.error("No tienes permiso para enviar archivos");
        return;
      }
      sendMediaFiles.mutate({ files: pendingFiles, caption: messageInput });
      return;
    }
    if (!messageInput.trim()) return;
    sendMessage.mutate(messageInput.trim());
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
        const visibleDigits = digitsFromText(visibleCode);
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
  const activeChatName = displayChatCode(activeChat);
  const activeChatFullName = displayChatName(activeChat);
  const headerLabel = activeChat?.labels?.[0] ?? null;
  const activeMessages = messages ?? [];
  const groupMemberCodes = useMemo(() => {
    if (!activeChat?.isGroup) return [];
    const byCode = new Map<string, { id: string; code: string; label: string; chatId?: string }>();
    const addMember = (id: string, name?: string | null) => {
      const raw = digitsFromText(name || id);
      if (raw.length < 6) return;
      const compact = raw.slice(-6);
      if (byCode.has(compact)) return;
      const matchedChat = chats?.find(
        (chat) => !chat.isGroup && (compactCode(chat.name) === compact || compactCode(chat.id) === compact),
      );
      byCode.set(compact, {
        id,
        code: formatSixDigitCode(compact),
        label: matchedChat ? displayChatCode(matchedChat) : formatSixDigitCode(compact),
        chatId: matchedChat?.id,
      });
    };

    activeChat.participants?.forEach((participant) => addMember(participant.id, participant.name));
    activeMessages.forEach((message) => {
      if (message.author) addMember(message.author, message.author);
    });

    return Array.from(byCode.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [activeChat, activeMessages, chats]);
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
    { key: "restrict", label: "Restringir chat", icon: <Briefcase className={menuIconClass} /> },
    { key: "close", label: "Cerrar chat", icon: <XCircle className={menuIconClass} /> },
  ];
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
          <RailButton tooltip="Medios">
            <Image className="h-[22px] w-[22px] stroke-[1.8]" />
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

      <section className="flex w-full min-w-[320px] shrink-0 flex-col border-r border-[#d1d7db] bg-white md:w-[420px] md:max-w-[32vw] xl:w-[440px]">
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
        <header className="relative flex h-[70px] shrink-0 items-center justify-between px-5">
          <h1 className="text-[26px] font-bold leading-none tracking-normal">WhatsApp</h1>
          <div className="flex items-center gap-3 text-[#111b21]">
            <button
              type="button"
              className="grid h-9 w-9 place-items-center rounded-full hover:bg-[#f0f2f5]"
              aria-label="Nuevo chat"
            >
              <Plus className="h-6 w-6 stroke-[2.1]" />
            </button>
            <button
              type="button"
              onClick={() => {
                setAppMenuOpen((v) => !v);
                closeMenus(setLabelMenuOpen, setChatMenuOpen, setHeaderLabelsOpen, setAttachmentMenuOpen, setEmojiOpen, setQuickReplyOpen);
              }}
              className="grid h-9 w-9 place-items-center rounded-full hover:bg-[#f0f2f5]"
              aria-label="Más opciones"
            >
              <MoreVertical className="h-6 w-6 stroke-[2.1]" />
            </button>
          </div>
          {appMenuOpen ? (
            <div className="absolute right-4 top-[56px] z-50 w-[290px] rounded-2xl border border-[#e1e4e6] bg-white py-2 shadow-[0_8px_28px_rgba(11,20,26,0.18)]">
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

        <div className="px-5 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-[#667781]" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar un chat o iniciar uno nuevo"
              className="h-11 w-full rounded-[22px] border-0 bg-[#f0f2f5] pl-12 pr-4 text-[16px] text-[#111b21] outline-none placeholder:text-[#667781]"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 px-5 pb-2">
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
              className={`h-9 rounded-full border px-4 text-[15px] font-semibold transition-colors ${
                filter === value && !showArchived
                  ? "border-[#bfc5c8] bg-[#f5f3f1] text-[#111b21]"
                  : "border-[#d1d7db] bg-white text-[#667781] hover:bg-[#f5f6f6]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative flex items-center gap-2 px-5 pb-3">
          <button
            type="button"
            onClick={() => {
              setLabelMenuOpen((v) => !v);
              closeMenus(setAppMenuOpen, setChatMenuOpen, setHeaderLabelsOpen, setAttachmentMenuOpen, setEmojiOpen, setQuickReplyOpen);
            }}
            className={`flex h-9 items-center gap-2 rounded-full border border-[#cfd4d8] px-4 text-[15px] font-semibold transition-colors ${
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
              className="h-9 rounded-full border border-[#cfd4d8] bg-white px-3 text-[13px] font-semibold text-[#667781]"
            >
              Archivados {archivedCount}
            </button>
          ) : null}
          {selectedLabel ? (
            <button
              type="button"
              onClick={() => setSelectedLabelId(null)}
              className="h-9 rounded-full border border-[#cfd4d8] bg-white px-3 text-[13px] font-semibold text-[#667781] hover:bg-[#f5f6f6]"
            >
              Quitar filtro
            </button>
          ) : null}
          {labelMenuOpen ? (
            <div className="absolute left-5 top-10 z-50 w-[260px] rounded-2xl border border-[#e1e4e6] bg-white py-3 shadow-[0_8px_28px_rgba(11,20,26,0.18)]">
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
            <div className="space-y-1 px-3 py-1">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex h-[76px] items-center gap-3 rounded-xl px-3">
                  <div className="h-12 w-12 shrink-0 animate-pulse rounded-full bg-[#eef0f2]" />
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
            <div className="px-3 pb-4">
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
                        className={`group flex w-full min-w-0 max-w-full items-center gap-3 overflow-hidden rounded-xl px-3 py-3 text-left transition-colors ${
                          selected ? "bg-[#f0f0f0]" : "hover:bg-[#f5f6f6]"
                        }`}
                      >
                        <AvatarBubble
                          name={displayChatName(chat)}
                          isGroup={chat.isGroup}
                          selected={selected}
                          imageSeed={index}
                          imageUrl={chat.profilePicUrl}
                          size="sm"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="mb-0.5 flex items-center gap-2">
                            <span className={`truncate text-[17px] leading-6 text-[#111b21] ${hasUnread ? "font-bold" : "font-semibold"}`}>
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
                          <div className={`flex min-w-0 items-center gap-1 text-[14px] leading-5 ${hasUnread ? "font-semibold text-[#111b21]" : "text-[#667781]"}`}>
                            {chat.pinned ? <Pin className="h-4 w-4 shrink-0" /> : null}
                            {fromMe ? <CheckCheck className="h-4 w-4 shrink-0 text-[#667781]" /> : null}
                            <span className="truncate">{preview}</span>
                          </div>
                        </div>
                        <div className="flex min-w-[76px] flex-col items-end gap-1 self-stretch py-0.5">
                          <span className={`text-[13px] font-semibold ${hasUnread ? "text-[#1fa855]" : "text-[#667781]"}`}>
                            {formatChatTime(chat.timestamp)}
                          </span>
                          <div className="flex min-h-5 items-center gap-1">
                            {badge > 0 ? (
                              <span
                                className="grid h-6 min-w-6 place-items-center rounded-full bg-[#1fa855] px-1.5 text-[12px] font-bold leading-none text-white shadow-sm"
                                title={`${badge} mensajes nuevos`}
                                aria-label={`${badge} mensajes nuevos`}
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
                                onSelect={(e) => {
                                  e.preventDefault();
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
                    setHeaderLabelsOpen((v) => !v);
                    closeMenus(setLabelMenuOpen, setAppMenuOpen, setChatMenuOpen, setAttachmentMenuOpen, setEmojiOpen, setQuickReplyOpen);
                  }}
                  className="flex h-10 max-w-[240px] items-center gap-2 rounded-full border border-[#d1d7db] bg-white px-4 hover:bg-[#f5f6f6]"
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
                <div className="absolute right-[260px] top-[56px] z-50 w-[305px] rounded-2xl border border-[#e1e4e6] bg-white py-3 shadow-[0_8px_28px_rgba(11,20,26,0.18)]">
                  <div className="max-h-[380px] overflow-y-auto px-3">
                    {labels && labels.length > 0 ? (
                      labels.map((label) => {
                        const attached = activeChat?.labels?.some((chatLabel) => chatLabel.id === label.id) ?? false;
                        return (
                          <button
                            key={label.id}
                            type="button"
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
                      <div className="px-3 py-4 text-sm text-[#667781]">Sin etiquetas.</div>
                    )}
                  </div>
                </div>
              ) : null}
              {chatMenuOpen ? (
                <div className="absolute right-5 top-[56px] z-50 w-[330px] rounded-2xl border border-[#e1e4e6] bg-white py-2 shadow-[0_8px_28px_rgba(11,20,26,0.18)]">
                  {chatMenuItems.map((item, index) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        if (item.key === "info") {
                          setDetailsPanelOpen(true);
                          setMediaPanelOpen(false);
                          setChatMenuOpen(false);
                        }
                        if (item.key === "mute" && activeChat) {
                          mutateChatState.mutate({
                            chat: activeChat,
                            patch: { muted: !activeChat.muted },
                          });
                          setChatMenuOpen(false);
                        }
                      }}
                      className={`flex min-h-12 w-full items-center gap-4 px-5 text-left text-[17px] text-[#111b21] hover:bg-[#f5f6f6] ${
                        index === 0 ? "rounded-xl outline outline-2 outline-[#111b21]" : ""
                      }`}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </button>
                  ))}
                  <div className="my-2 h-px bg-[#eef0f2]" />
                  {[
                    { label: "Reportar", icon: <Flag className={menuIconClass} /> },
                    { label: "Bloquear", icon: <Ban className={menuIconClass} /> },
                    { label: "Vaciar chat", icon: <Eraser className={menuIconClass} /> },
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => undefined}
                      className="flex min-h-12 w-full items-center gap-4 px-5 text-left text-[17px] text-[#111b21] hover:bg-[#f5f6f6]"
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
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
                ) : messages?.length === 0 ? (
                  <div className="self-center rounded-lg bg-[#fff5c4] px-4 py-3 text-sm text-[#5f5500] shadow-sm">
                    Envía un mensaje para iniciar.
                  </div>
                ) : (
                  messages?.map((msg) => {
                    const encodedBody = looksLikeEncodedMedia(msg.body || "");
                    const showMediaCard = msg.hasMedia || encodedBody;
                    const body = encodedBody ? "" : msg.body;
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

                    return (
                      <div
                        key={msg.id}
                        className={`flex max-w-[74%] flex-col ${msg.fromMe ? "self-end items-end" : "self-start items-start"}`}
                      >
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
                          {!visualOnly && !msg.fromMe && activeChat?.isGroup && msg.author ? (
                            <div className="mb-1 text-[14px] font-bold text-[#00a884]">
                              {formatSixDigitCode(msg.author)}
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
                              <a
                                href={imageSrc}
                                target="_blank"
                                rel="noreferrer"
                                className={`block overflow-hidden ${visualOnly ? "rounded-lg" : "rounded-lg bg-black/5"}`}
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
                              </a>
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
              <form onSubmit={handleSend} className="mx-auto flex max-w-[1320px] items-end gap-3">
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
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend(e);
                      }
                    }}
                    disabled={!currentPermissions.canReply}
                    placeholder={currentPermissions.canReply ? "Escribe un mensaje" : "Sin permiso para responder"}
                    className="h-7 max-h-32 min-h-7 w-full resize-none bg-transparent text-[18px] leading-7 text-[#111b21] outline-none placeholder:text-[#7a7f83]"
                    rows={1}
                  />
                </div>
                <Button
                  type="submit"
                  size="icon"
                  disabled={sendMessage.isPending || sendMediaFiles.isPending || !currentPermissions.canReply}
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
                                if (member.chatId) {
                                  setActiveChatId(member.chatId);
                                  setDetailsPanelOpen(false);
                                } else {
                                  toast.info("Ese código aún no tiene chat individual en la lista.");
                                }
                              }}
                              className="rounded-full border border-[#d1d7db] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#111b21] hover:bg-[#eef0f2]"
                            >
                              {member.label}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="text-[13px] text-[#667781]">Sin códigos detectados todavía.</div>
                      )}
                    </div>
                  ) : null}
                  <div className="mt-5 flex w-full gap-2">
                    <button type="button" className="flex-1 rounded-xl border border-[#d1d7db] px-4 py-3 text-[14px] font-semibold hover:bg-[#f5f6f6]">
                      Añadir
                    </button>
                    <button type="button" className="flex-1 rounded-xl border border-[#d1d7db] px-4 py-3 text-[14px] font-semibold hover:bg-[#f5f6f6]">
                      Busca
                    </button>
                  </div>
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
                      })
                    }
                    className="flex h-14 w-full items-center gap-4 text-left text-[15px] hover:bg-[#f7f8f8]"
                  >
                    <VolumeX className={`h-5 w-5 ${activeChat.muted ? "text-[#008069]" : "text-[#667781]"}`} />
                    {activeChat.muted ? "Reactivar notificaciones" : "Silenciar notificaciones"}
                  </button>
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
                        {mediaItems.map((msg) => (
                          <a
                            key={msg.id}
                            href={msg.mediaUrl || "#"}
                            target="_blank"
                            rel="noreferrer"
                            className="aspect-square overflow-hidden rounded-md bg-[#f0f2f5]"
                          >
                            {isVideoMessage(msg) ? (
                              <VideoPreview src={msg.mediaUrl || ""} compact />
                            ) : (
                              <img src={msg.mediaUrl || ""} alt="" className="h-full w-full object-cover" />
                            )}
                          </a>
                        ))}
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
