/**
 * api-keys.ts
 *
 * API key business logic: create (returning the raw key once), list metadata,
 * revoke, and authenticate a presented key for the machine REST path. All
 * operations are scoped to the acting user; the machine path resolves the
 * owning user from the key hash.
 */
import type { ApiKeyMetadata, CreateApiKeyResponse } from "../dto/types.ts";
import { config } from "../lib/config.ts";
import { Tokens } from "../lib/tokens.ts";
import { ApiKeysModel } from "../models/api-keys.ts";
import type { ApiKeyMetadata as ApiKeyMetadataRow } from "../models/types.ts";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export class ApiKeysService {
  /** Map a database row (Date fields) to the wire shape (ISO strings). */
  static #toWireMetadata(row: ApiKeyMetadataRow): ApiKeyMetadata {
    return {
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      id: row.id,
      name: row.name,
      ...(row.lastUsedAt ? { lastUsedAt: row.lastUsedAt.toISOString() } : {}),
    };
  }

  /**
   * Create an API key for the user. Returns the metadata plus the raw key, which
   * is shown once and never stored (only its hash is kept).
   */
  public static async create({
    userId,
    name,
  }: {
    userId: string;
    name: string;
  }): Promise<CreateApiKeyResponse> {
    const { rawKey, keyHash } = Tokens.generateApiKey();
    const expiresAt = new Date(
      Date.now() + config.constants.apiKeyExpiryDays * MILLISECONDS_PER_DAY,
    );
    const row = await ApiKeysModel.create({ expiresAt, keyHash, name, userId });
    return { ...ApiKeysService.#toWireMetadata(row), key: rawKey };
  }

  /** List the user's API keys (metadata only). */
  public static async list(userId: string): Promise<ApiKeyMetadata[]> {
    const rows = await ApiKeysModel.list(userId);
    return rows.map((row) => ApiKeysService.#toWireMetadata(row));
  }

  /**
   * Revoke a key by id, scoped to the user. Returns true if a key was deleted,
   * false if none matched (caller returns 404).
   */
  public static revoke({ userId, id }: { userId: string; id: string }): Promise<boolean> {
    return ApiKeysModel.delete({ id, userId });
  }

  /**
   * Authenticate a presented raw API key for the machine path. Returns the
   * owning user id, or undefined for a missing, revoked, or expired key. Records
   * last-used on success.
   *
   * @param rawKey - the key from the Authorization header.
   */
  public static async authenticate(rawKey: string): Promise<string | undefined> {
    const row = await ApiKeysModel.findByHash(Tokens.hashApiKey(rawKey));
    if (row === undefined) {
      return undefined;
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      return undefined;
    }
    await ApiKeysModel.touchLastUsed({ id: row.id, now: new Date() });
    return row.userId;
  }
}
