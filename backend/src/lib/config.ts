/**
 * config.ts
 *
 * Single source of configuration for the backend. This is the ONLY file that
 * reads `process.env`; every other module imports `config`. The whole
 * environment is validated with a Zod schema at import time (unknown variables
 * are ignored). The exported object is recursively frozen with deep-freeze-es6
 * (Object.freeze is only shallow). It also holds every magic value so none are
 * hard-coded elsewhere.
 */
import { deepFreeze } from "deep-freeze-es6";
import { z } from "zod";

/** Coerce an env string to a finite number, rejecting missing or non-numeric values. */
const numberFromEnv = z.coerce.number().refine(Number.isFinite, "must be a finite number");

/** Schema for the environment variables the backend needs. Unknown variables are ignored. */
const envSchema = z.object({
  ENCRYPTION_KEY: z.string().min(1),
  JIRA_CLIENT_ID: z.string().min(1),
  JIRA_CLIENT_SECRET: z.string().min(1),
  OAUTH_CALLBACK_URL: z.string().min(1),
  PORT: numberFromEnv,
  POSTGRES_DB: z.string().min(1),
  POSTGRES_HOST: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(1),
  POSTGRES_PORT: numberFromEnv,
  POSTGRES_USER: z.string().min(1),
  REDIS_HOST: z.string().min(1),
  REDIS_PASSWORD: z.string().min(1),
  REDIS_PORT: numberFromEnv,
});

const env = envSchema.parse(process.env);

/** Typed, deeply frozen application configuration. Import this; never read process.env directly. */
export const config = deepFreeze({
  constants: {
    apiKeyExpiryDays: 90,
    cache: {
      meAndProjectsTtlSeconds: 300,
      recentTicketsTtlSeconds: 10,
    },
    recentTicketsLimit: 10,
    sessionTtlSeconds: 12 * 60 * 60,
    validation: {
      descriptionMaxLength: 32_767,
      // Jira summary hard limit is 255 characters.
      titleMaxLength: 255,
    },
  },
  encryptionKey: env.ENCRYPTION_KEY,
  jira: {
    clientId: env.JIRA_CLIENT_ID,
    clientSecret: env.JIRA_CLIENT_SECRET,
  },
  postgres: {
    database: env.POSTGRES_DB,
    host: env.POSTGRES_HOST,
    password: env.POSTGRES_PASSWORD,
    // Fixed-size pool: constant 10 connections (min = max).
    poolMax: 10,
    poolMin: 10,
    port: env.POSTGRES_PORT,
    user: env.POSTGRES_USER,
  },
  redis: {
    host: env.REDIS_HOST,
    password: env.REDIS_PASSWORD,
    port: env.REDIS_PORT,
  },
  server: {
    oauthCallbackUrl: env.OAUTH_CALLBACK_URL,
    port: env.PORT,
  },
} as const);

export type Config = typeof config;
