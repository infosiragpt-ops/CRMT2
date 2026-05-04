import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

let schemaReady: Promise<void> | null = null;

export function ensureQuickRepliesSchema() {
  schemaReady ??= (async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS quick_replies (
        id serial PRIMARY KEY,
        user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        shortcut text NOT NULL,
        title text NOT NULL DEFAULT '',
        body text NOT NULL DEFAULT '',
        created_at timestamp with time zone NOT NULL DEFAULT now(),
        updated_at timestamp with time zone NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS quick_replies_user_shortcut_uidx
        ON quick_replies (user_id, shortcut)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS quick_replies_user_idx
        ON quick_replies (user_id)
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS quick_reply_attachments (
        id serial PRIMARY KEY,
        quick_reply_id integer NOT NULL REFERENCES quick_replies(id) ON DELETE CASCADE,
        kind text NOT NULL,
        file_name text NOT NULL,
        stored_path text NOT NULL,
        mime_type text NOT NULL,
        size_bytes integer NOT NULL DEFAULT 0,
        created_at timestamp with time zone NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS quick_reply_attachments_qr_idx
        ON quick_reply_attachments (quick_reply_id)
    `);
  })();
  return schemaReady;
}
