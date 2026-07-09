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
    // Refresh the Jira access token this many seconds before it actually
    // expires, so a call never goes out with an access token about to lapse.
    accessTokenRefreshSkewSeconds: 30,
    // Upper bound on a requested API key lifetime (10 years). The caller picks
    // the actual expiry when creating the key.
    apiKeyMaxExpiryDays: 3650,
    // Prefix on raw API keys, so a leaked key is recognizable in logs/scanners.
    apiKeyPrefix: "ih_",
    apiKeyRandomBytes: 32,
    cache: {
      assignableUsersTtlSeconds: 60,
      meAndProjectsTtlSeconds: 300,
      recentTicketsTtlSeconds: 10,
    },
    // The optional Jira fields we surface when a project exposes them. Anything
    // outside this set (except project-required fields) is intentionally hidden.
    curatedOptionalFieldIds: ["priority", "labels", "assignee", "duedate", "components"],
    // Jira fields we never render dynamically: title/description have dedicated
    // inputs; project, issue type, and reporter are set automatically.
    excludedFieldIds: ["summary", "description", "project", "issuetype", "reporter"],
    // Atlassian endpoints and Jira client tuning.
    jira: {
      // accessible-resources lists the sites the user granted.
      accessibleResourcesUrl: "https://api.atlassian.com/oauth/token/accessible-resources",
      // Base for authenticated Jira REST calls; the cloud id selects the site.
      apiBaseUrl: "https://api.atlassian.com/ex/jira",
      // Cap for a single page of assignable users (POC: one page is enough).
      assignableUsersPageSize: 100,
      // The identity (/me) endpoint.
      identityUrl: "https://api.atlassian.com/me",
      // Only the summary is fetched when refreshing a Recent Tickets title.
      issueSummaryFields: ["summary"],
      // Retry budget: 4 retries (5 attempts total).
      maxRetries: 4,
      // Cap for a single page of creatable projects (POC: one page is enough).
      projectsPageSize: 100,
      // OAuth token exchange / refresh endpoint.
      tokenUrl: "https://auth.atlassian.com/oauth/token",
    },
    // pino log level. "debug" surfaces per-layer detail; "info" is the default.
    logLevel: "info",
    // Atlassian 3LO OAuth parameters.
    oauth: {
      audience: "api.atlassian.com",
      authorizeUrl: "https://auth.atlassian.com/authorize",
      // Granular scopes for the operations we call, plus identity and refresh.
      scopes: "read:jira-work write:jira-work read:jira-user read:me offline_access",
    },
    // OAuth CSRF `state` lifetime: long enough to log in, short enough to bound
    // replay. The state is single-use (consumed on callback).
    oauthStateTtlSeconds: 600,
    // A finding maps to a Task; fall back to the project's first issue type.
    preferredIssueTypeName: "Task",
    recentTicketsLimit: 10,
    sessionCookieName: "ih_session",
    sessionIdRandomBytes: 32,
    sessionTtlSeconds: 12 * 60 * 60,
    stateRandomBytes: 32,
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
