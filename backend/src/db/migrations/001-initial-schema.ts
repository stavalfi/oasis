/**
 * 001-initial-schema.ts
 *
 * Initial IdentityHub schema. One user equals one tenant equals one connected
 * Jira site. Every tenant-owned table carries `user_id` so all data access can
 * be scoped by the authenticated user at the models choke point. Migrations are
 * schema-agnostic, so the Kysely instance is untyped here (the typed schema is
 * generated from the live database after migrations run).
 */
import { type Kysely, sql } from "kysely";

/** Apply the initial schema. */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable("users")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("atlassian_account_id", "text", (col) => col.notNull().unique())
    .addColumn("email", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // One connected Jira site per user (the tenant record). Tokens are stored
  // field-level encrypted; access_token_expires_at drives proactive refresh.
  await db.schema
    .createTable("jira_connections")
    .addColumn("user_id", "uuid", (col) =>
      col.primaryKey().references("users.id").onDelete("cascade"),
    )
    .addColumn("cloud_id", "text", (col) => col.notNull())
    .addColumn("site_url", "text", (col) => col.notNull())
    .addColumn("enc_access_token", "text", (col) => col.notNull())
    .addColumn("enc_refresh_token", "text", (col) => col.notNull())
    .addColumn("access_token_expires_at", "timestamptz", (col) => col.notNull())
    .execute();

  // Opaque server-side sessions. Rolling expiry: expires_at is extended on each
  // authenticated request. Revocable by deleting the row.
  await db.schema
    .createTable("sessions")
    .addColumn("session_id", "text", (col) => col.primaryKey())
    .addColumn("user_id", "uuid", (col) => col.notNull().references("users.id").onDelete("cascade"))
    .addColumn("expires_at", "timestamptz", (col) => col.notNull())
    .execute();
  await db.schema.createIndex("sessions_user_id_idx").on("sessions").column("user_id").execute();

  // Machine credentials. Only the hash is stored; the raw key is shown once.
  await db.schema
    .createTable("api_keys")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("user_id", "uuid", (col) => col.notNull().references("users.id").onDelete("cascade"))
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("key_hash", "text", (col) => col.notNull().unique())
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("last_used_at", "timestamptz")
    .addColumn("expires_at", "timestamptz", (col) => col.notNull())
    .execute();

  // References to issues we created, scoped by user. Content lives in Jira; we
  // store only keys and order. The composite index serves the Recent Tickets
  // query (per user, per project, newest first).
  await db.schema
    .createTable("tickets")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("user_id", "uuid", (col) => col.notNull().references("users.id").onDelete("cascade"))
    .addColumn("project_key", "text", (col) => col.notNull())
    .addColumn("jira_issue_key", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema
    .createIndex("tickets_recent_idx")
    .on("tickets")
    .columns(["user_id", "project_key", "created_at"])
    .execute();
};

/** Drop everything the up migration created (reverse dependency order). */
export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable("tickets").ifExists().execute();
  await db.schema.dropTable("api_keys").ifExists().execute();
  await db.schema.dropTable("sessions").ifExists().execute();
  await db.schema.dropTable("jira_connections").ifExists().execute();
  await db.schema.dropTable("users").ifExists().execute();
};
