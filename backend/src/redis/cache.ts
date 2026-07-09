/**
 * cache.ts
 *
 * The two-tier cache used by every cached read, backed by cache-manager. The
 * first tier is a per-process in-memory Keyv store; the second tier is Redis
 * (shared across instances). cache-manager's `wrap` gives read-through
 * (in-memory, then Redis, then the source), and `del` removes from both tiers.
 * Each cached value is re-validated with a Zod schema on the way out, so a
 * malformed or stale-shaped entry can never be returned untyped. Every cache key
 * must already include the tenant's `user_id` (built by the caller), so one
 * tenant is never served another's data. Part of the redis choke point.
 */
import KeyvRedis from "@keyv/redis";
import { createCache } from "cache-manager";
import type { Cache as CacheManagerCache } from "cache-manager";
import { Keyv } from "keyv";
import type { ZodType } from "zod";
import { config } from "../config.ts";

export class Cache {
  /** Two-tier cache-manager instance: in-memory L1 plus a shared Redis L2. */
  static readonly #cache = Cache.#createCache();

  /** Build the layered cache: an in-memory Keyv tier over a Redis Keyv tier. */
  static #createCache(): CacheManagerCache {
    const inMemoryTier = new Keyv();
    const redisUrl = `redis://:${encodeURIComponent(config.redis.password)}@${config.redis.host}:${config.redis.port}`;
    const redisTier = new Keyv({ store: new KeyvRedis(redisUrl) });
    return createCache({ stores: [inMemoryTier, redisTier] });
  }

  /** Cache key for the current-user view. */
  public static keyForMe(userId: string): string {
    return `me:${userId}`;
  }

  /** Cache key for the projects list. */
  public static keyForProjects(userId: string): string {
    return `projects:${userId}`;
  }

  /** Cache key for a project's recent tickets. */
  public static keyForRecentTickets({
    userId,
    projectKey,
  }: {
    userId: string;
    projectKey: string;
  }): string {
    return `recent_tickets:${userId}:${projectKey}`;
  }

  /** Cache key for a project's assignable users. */
  public static keyForAssignableUsers({
    userId,
    projectKey,
  }: {
    userId: string;
    projectKey: string;
  }): string {
    return `assignable_users:${userId}:${projectKey}`;
  }

  /**
   * Return a cached value if present and fresh, otherwise load it, populate both
   * tiers, and return it. The result is validated against the schema.
   *
   * @param key - the full cache key (must include the tenant user_id).
   * @param ttlSeconds - lifetime for freshly written entries.
   * @param schema - Zod schema the cached value is validated against.
   * @param load - source loader, called only on a full miss.
   */
  public static async getOrLoad<Value>({
    key,
    ttlSeconds,
    schema,
    load,
  }: {
    key: string;
    ttlSeconds: number;
    schema: ZodType<Value>;
    load: () => Promise<Value>;
  }): Promise<Value> {
    const value = await Cache.#cache.wrap(key, load, ttlSeconds * 1000);
    return schema.parse(value);
  }

  /**
   * Remove a key from both tiers so a write is visible immediately instead of
   * waiting for the TTL.
   *
   * @param key - the full cache key to invalidate.
   */
  public static async invalidate(key: string): Promise<void> {
    await Cache.#cache.del(key);
  }
}
