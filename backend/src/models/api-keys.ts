/**
 * api-keys.ts
 *
 * Model for the `api_keys` table: machine credentials stored as a hash only.
 * Object-level authorization is enforced here by scoping mutations to the
 * acting `user_id`. The only code that reads or writes `api_keys`.
 */
import { db } from "../db/database.ts";
import { type ApiKeyAuthRow, type ApiKeyMetadata } from "./types.ts";

export class ApiKeysModel {
  /**
   * Store a new API key (hash only), bound to the user. Returns its metadata;
   * the raw key is shown once by the caller and never stored.
   */
  public static async create({
    userId,
    name,
    keyHash,
    expiresAt,
  }: {
    userId: string;
    name: string;
    keyHash: string;
    expiresAt: Date;
  }): Promise<ApiKeyMetadata> {
    const row = await db
      .insertInto("api_keys")
      .values({ expires_at: expiresAt, key_hash: keyHash, name, user_id: userId })
      .returning(["id", "name", "created_at", "last_used_at", "expires_at"])
      .executeTakeFirstOrThrow();
    return {
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      id: row.id,
      lastUsedAt: row.last_used_at,
      name: row.name,
    };
  }

  /** List the user's API keys (metadata only), newest first. */
  public static async list(userId: string): Promise<ApiKeyMetadata[]> {
    const rows = await db
      .selectFrom("api_keys")
      .select(["id", "name", "created_at", "last_used_at", "expires_at"])
      .where("user_id", "=", userId)
      .orderBy("created_at", "desc")
      .execute();
    return rows.map((row) => ({
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      id: row.id,
      lastUsedAt: row.last_used_at,
      name: row.name,
    }));
  }

  /**
   * Find the key row matching a presented hash, for authentication. A revoked
   * key has no row, so this returns undefined for missing or revoked keys.
   */
  public static async findByHash(keyHash: string): Promise<ApiKeyAuthRow | undefined> {
    const row = await db
      .selectFrom("api_keys")
      .select(["id", "user_id", "expires_at"])
      .where("key_hash", "=", keyHash)
      .executeTakeFirst();
    if (row === undefined) {
      return undefined;
    }
    return { expiresAt: row.expires_at, id: row.id, userId: row.user_id };
  }

  /** Record that a key was just used (last_used_at = now). */
  public static async touchLastUsed({ id, now }: { id: string; now: Date }): Promise<void> {
    await db.updateTable("api_keys").set({ last_used_at: now }).where("id", "=", id).execute();
  }

  /**
   * Revoke (delete) a key by id, scoped to the owning user. Returns true if a
   * row was deleted, false if none matched (so the caller can return 404).
   */
  public static async delete({ id, userId }: { id: string; userId: string }): Promise<boolean> {
    const result = await db
      .deleteFrom("api_keys")
      .where("id", "=", id)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    return result.numDeletedRows > 0n;
  }
}
