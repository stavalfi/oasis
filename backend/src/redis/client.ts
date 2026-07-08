/**
 * client.ts
 *
 * The single ioredis connection. Part of the redis choke point: nothing outside
 * the `redis/` directory talks to Redis directly.
 */
import { Redis } from "ioredis";
import { config } from "../lib/config.ts";

/** The shared Redis connection. Used by the cache and the OAuth state store. */
export const redis = new Redis({
  host: config.redis.host,
  // Fail a command after a few retries rather than blocking forever, so a Redis
  // outage surfaces quickly (and the readiness probe can report it).
  maxRetriesPerRequest: 3,
  password: config.redis.password,
  port: config.redis.port,
});
