import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

let schemaReady: Promise<void> | null = null;

export function ensureInternalMessagesSchema() {
  schemaReady ??= (async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS internal_messages (
        id serial PRIMARY KEY,
        sender_user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        recipient_user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body text NOT NULL DEFAULT '',
        file_name text,
        file_path text,
        file_mime_type text,
        file_size_bytes integer,
        read_at timestamp with time zone,
        created_at timestamp with time zone NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS internal_messages_sender_recipient_created_idx
        ON internal_messages (sender_user_id, recipient_user_id, created_at)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS internal_messages_recipient_read_idx
        ON internal_messages (recipient_user_id, read_at)
    `);
  })();
  return schemaReady;
}
