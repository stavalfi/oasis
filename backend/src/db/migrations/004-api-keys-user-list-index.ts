/**
 * 004-api-keys-user-list-index.ts
 *
 * The API-keys management screen lists a user's keys newest-first
 * (`where user_id = ? order by created_at desc`). The only api_keys indexes so
 * far were the `id` primary key and the `key_hash` unique index (the auth hot
 * path), so that list did a sequential scan. Add a `(user_id, created_at)`
 * index whose column order matches the filter-then-sort, letting the read walk
 * the btree backward instead of scanning and sorting.
 */
import type { Kysely } from "kysely";

/** Add the composite index backing the per-user key listing. */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createIndex("api_keys_user_list_idx")
    .on("api_keys")
    .columns(["user_id", "created_at"])
    .execute();
};

/** Drop the per-user listing index. */
export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropIndex("api_keys_user_list_idx").ifExists().execute();
};
