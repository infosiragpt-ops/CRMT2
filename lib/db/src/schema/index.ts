import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  boolean,
  uniqueIndex,
  index,
  primaryKey,
  bigint,
  jsonb,
  varchar,
  json,
} from "drizzle-orm/pg-core";

export type CollaboratorPermissions = {
  canReply: boolean;
  canSendMedia: boolean;
  canUseQuickReplies: boolean;
  canManageQuickReplies: boolean;
  canManageLabels: boolean;
  canManageChats: boolean;
};

export const DEFAULT_COLLABORATOR_PERMISSIONS: CollaboratorPermissions = {
  canReply: true,
  canSendMedia: true,
  canUseQuickReplies: true,
  canManageQuickReplies: true,
  canManageLabels: true,
  canManageChats: true,
};

// Managed by connect-pg-simple at runtime. Declared here so drizzle-kit does not
// try to drop it when diffing the schema.
export const userSessionsTable = pgTable("user_sessions", {
  sid: varchar("sid").primaryKey(),
  sess: json("sess").notNull(),
  expire: timestamp("expire", { precision: 6, mode: "date" }).notNull(),
});

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("user"),
  permissions: jsonb("permissions")
    .$type<CollaboratorPermissions>()
    .notNull()
    .default(DEFAULT_COLLABORATOR_PERMISSIONS),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;

export type AgentTrainingConfig = {
  voiceReplies?: boolean;
  audioToText?: boolean;
  trainingEnabled?: {
    text?: boolean;
    images?: boolean;
    video?: boolean;
    pdf?: boolean;
  };
  responseScope?: string;
  selectedLabelIds?: number[];
  textRules?: Array<{ trigger: string; response: string }>;
  assets?: {
    images?: Array<{ fileName: string; mimeType: string; sizeBytes: number; trigger: string; storedPath?: string }>;
    video?: Array<{ fileName: string; mimeType: string; sizeBytes: number; trigger: string; storedPath?: string }>;
    pdf?: Array<{ fileName: string; mimeType: string; sizeBytes: number; trigger: string; storedPath?: string }>;
  };
};

export const agentSettingsTable = pgTable("agent_settings", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  model: text("model").notNull().default("gpt-4.1-mini"),
  openAiApiKeyEncrypted: text("openai_api_key_encrypted"),
  trainingConfig: jsonb("training_config").$type<AgentTrainingConfig>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AgentSettings = typeof agentSettingsTable.$inferSelect;
export type InsertAgentSettings = typeof agentSettingsTable.$inferInsert;

export const devicesTable = pgTable(
  "devices",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sessionId: text("session_id").notNull().unique(),
    status: text("status").notNull().default("disconnected"),
    phoneNumber: text("phone_number"),
    profileName: text("profile_name"),
    lastConnectedAt: timestamp("last_connected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sessionUidx: uniqueIndex("devices_session_uidx").on(t.sessionId),
    userIdx: index("devices_user_idx").on(t.userId),
  }),
);

export type Device = typeof devicesTable.$inferSelect;
export type InsertDevice = typeof devicesTable.$inferInsert;

export const chatsTable = pgTable(
  "chats",
  {
    id: serial("id").primaryKey(),
    deviceId: integer("device_id")
      .notNull()
      .references(() => devicesTable.id, { onDelete: "cascade" }),
    waChatId: text("wa_chat_id").notNull(),
    name: text("name").notNull().default(""),
    isGroup: boolean("is_group").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    favorited: boolean("favorited").notNull().default(false),
    pinned: boolean("pinned").notNull().default(false),
    muted: boolean("muted").notNull().default(false),
    emailNotifications: boolean("email_notifications").notNull().default(true),
    manuallyUnread: boolean("manually_unread").notNull().default(false),
    unreadCount: integer("unread_count").notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    lastMessagePreview: text("last_message_preview"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    deviceWaChatUidx: uniqueIndex("chats_device_wachat_uidx").on(t.deviceId, t.waChatId),
    deviceArchivedIdx: index("chats_device_archived_idx").on(t.deviceId, t.archived),
    deviceLastMsgIdx: index("chats_device_lastmsg_idx").on(t.deviceId, t.lastMessageAt),
  }),
);

export type Chat = typeof chatsTable.$inferSelect;
export type InsertChat = typeof chatsTable.$inferInsert;

export const messagesTable = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    chatId: integer("chat_id")
      .notNull()
      .references(() => chatsTable.id, { onDelete: "cascade" }),
    waMessageId: text("wa_message_id").notNull(),
    fromMe: boolean("from_me").notNull().default(false),
    author: text("author"),
    body: text("body").notNull().default(""),
    type: text("type").notNull().default("chat"),
    hasMedia: boolean("has_media").notNull().default(false),
    mediaType: text("media_type"),
    mediaPath: text("media_path"),
    timestamp: bigint("timestamp", { mode: "number" }).notNull(),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    chatWaMsgUidx: uniqueIndex("messages_chat_wamsg_uidx").on(t.chatId, t.waMessageId),
    chatTsIdx: index("messages_chat_ts_idx").on(t.chatId, t.timestamp),
  }),
);

export type Message = typeof messagesTable.$inferSelect;
export type InsertMessage = typeof messagesTable.$inferInsert;

export const chatNotesTable = pgTable(
  "chat_notes",
  {
    id: serial("id").primaryKey(),
    chatId: integer("chat_id")
      .notNull()
      .references(() => chatsTable.id, { onDelete: "cascade" }),
    authorUserId: integer("author_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    body: text("body").notNull().default(""),
    fileName: text("file_name"),
    filePath: text("file_path"),
    fileMimeType: text("file_mime_type"),
    fileSizeBytes: integer("file_size_bytes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    chatCreatedIdx: index("chat_notes_chat_created_idx").on(t.chatId, t.createdAt),
    authorIdx: index("chat_notes_author_idx").on(t.authorUserId),
  }),
);

export type ChatNote = typeof chatNotesTable.$inferSelect;
export type InsertChatNote = typeof chatNotesTable.$inferInsert;

export const labelsTable = pgTable(
  "labels",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#3b82f6"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userNameUidx: uniqueIndex("labels_user_name_uidx").on(t.userId, t.name),
    userIdx: index("labels_user_idx").on(t.userId),
  }),
);

export type Label = typeof labelsTable.$inferSelect;
export type InsertLabel = typeof labelsTable.$inferInsert;

export const chatLabelsTable = pgTable(
  "chat_labels",
  {
    chatId: integer("chat_id")
      .notNull()
      .references(() => chatsTable.id, { onDelete: "cascade" }),
    labelId: integer("label_id")
      .notNull()
      .references(() => labelsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.chatId, t.labelId] }),
    labelIdx: index("chat_labels_label_idx").on(t.labelId),
  }),
);

export type ChatLabel = typeof chatLabelsTable.$inferSelect;

export const quickRepliesTable = pgTable(
  "quick_replies",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    shortcut: text("shortcut").notNull(),
    title: text("title").notNull().default(""),
    body: text("body").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userShortcutUidx: uniqueIndex("quick_replies_user_shortcut_uidx").on(t.userId, t.shortcut),
    userIdx: index("quick_replies_user_idx").on(t.userId),
  }),
);

export type QuickReply = typeof quickRepliesTable.$inferSelect;
export type InsertQuickReply = typeof quickRepliesTable.$inferInsert;

export const quickReplyAttachmentsTable = pgTable(
  "quick_reply_attachments",
  {
    id: serial("id").primaryKey(),
    quickReplyId: integer("quick_reply_id")
      .notNull()
      .references(() => quickRepliesTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    fileName: text("file_name").notNull(),
    storedPath: text("stored_path").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    qrIdx: index("quick_reply_attachments_qr_idx").on(t.quickReplyId),
  }),
);

export type QuickReplyAttachment = typeof quickReplyAttachmentsTable.$inferSelect;
export type InsertQuickReplyAttachment = typeof quickReplyAttachmentsTable.$inferInsert;
