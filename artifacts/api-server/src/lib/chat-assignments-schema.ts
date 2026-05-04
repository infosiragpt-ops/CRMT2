import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

let schemaReady: Promise<void> | null = null;

export function ensureChatAssignmentsSchema() {
  schemaReady ??= (async () => {
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS label_color text NOT NULL DEFAULT '#00a884'`);
    await db.execute(sql`ALTER TABLE chats ADD COLUMN IF NOT EXISTS custom_name text`);
    await db.execute(sql`ALTER TABLE chats ADD COLUMN IF NOT EXISTS phone_number text`);
    await db.execute(sql`ALTER TABLE chats ADD COLUMN IF NOT EXISTS phone_code text`);
    await db.execute(sql`ALTER TABLE chats ADD COLUMN IF NOT EXISTS phone_code_verified boolean NOT NULL DEFAULT false`);
    await db.execute(sql`ALTER TABLE chats ADD COLUMN IF NOT EXISTS phone_code_source text`);
    await db.execute(sql`
      ALTER TABLE chats
        ADD COLUMN IF NOT EXISTS assigned_user_id integer REFERENCES users(id) ON DELETE SET NULL
    `);
    await db.execute(sql`
      ALTER TABLE chats
        ADD COLUMN IF NOT EXISTS assigned_by_user_id integer REFERENCES users(id) ON DELETE SET NULL
    `);
    await db.execute(sql`ALTER TABLE chats ADD COLUMN IF NOT EXISTS assigned_at timestamp with time zone`);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS chats_assigned_user_idx
        ON chats (assigned_user_id, assigned_at)
    `);
  })();
  return schemaReady;
}
