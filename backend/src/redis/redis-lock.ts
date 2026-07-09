/**
 * redis-lock.ts
 *
 * The single Redlock instance (the maintained @sesamecare-oss/redlock fork) over
 * the shared Redis connection, plus a thin withLock helper. Used to serialize
 * per-user token refresh across pods so concurrent requests don't each spend the
 * same rotating refresh token. Part of the redis choke point: nothing outside
 * `redis/` talks to Redis directly.
 */
import { Redlock } from "@sesamecare-oss/redlock";
import { config } from "../config.ts";
import { redis } from "./client.ts";

// Single-node redlock: acquire with bounded retries, auto-extend while the
// critical section runs, and release afterward. Lock values are generated and
// checked by the library, so a lock is never released or extended by a
// non-owner.
const redlock = new Redlock([redis], {
  automaticExtensionThreshold: config.constants.refreshLock.extensionThresholdMs,
  retryCount: config.constants.refreshLock.retryCount,
  retryDelay: config.constants.refreshLock.retryDelayMs,
  retryJitter: config.constants.refreshLock.retryJitterMs,
});

export class RedisLock {
  /**
   * Run `routine` while holding the lock for `key`. Acquires the lock first
   * (retrying while another holder has it), auto-extends it while the routine
   * runs, and releases it after. Throws if the lock cannot be acquired within
   * the configured retries.
   *
   * @param key - the lock key (one per resource, e.g. per user).
   * @param routine - the critical section to run under the lock.
   */
  public static withLock<T>({
    key,
    routine,
  }: {
    key: string;
    routine: () => Promise<T>;
  }): Promise<T> {
    return redlock.using([key], config.constants.refreshLock.ttlSeconds * 1000, () => routine());
  }
}
