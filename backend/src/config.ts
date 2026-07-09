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

/**
 * An optional string env var. An empty value (a `NAME=` line in .env) is treated
 * as absent, so a blank placeholder does not count as configured.
 */
const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

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

/** All blog-summary secrets, required together (used when the feature is on). */
const blogSummaryRequiredSchema = z.object({
  AIONLABS_API_KEY: z.string(),
  JIRA_SUMMARY_API_TOKEN: z.string(),
  JIRA_SUMMARY_BASE_URL: z.string(),
  JIRA_SUMMARY_EMAIL: z.string(),
  JIRA_SUMMARY_PROJECT_KEY: z.string(),
  KAFKA_BROKERS: z.string(),
});

/**
 * The bonus NHI Blog Summary secrets, validated as an all-or-none group at
 * startup: none set -> `undefined` (the feature is off and the web API runs
 * alone); all set -> the structured config; partially set -> a validation error
 * (fail fast, so a half-configured deploy is caught immediately). Empty `.env`
 * values count as unset. These live outside the required `envSchema` so the web
 * API starts without them. Summary tickets are filed by a service account (Basic
 * auth with a hard-coded Atlassian API token), independent of the per-user OAuth
 * path.
 */
const blogSummaryEnvSchema = z
  .object({
    AIONLABS_API_KEY: optionalString,
    JIRA_SUMMARY_API_TOKEN: optionalString,
    JIRA_SUMMARY_BASE_URL: optionalString,
    JIRA_SUMMARY_EMAIL: optionalString,
    JIRA_SUMMARY_PROJECT_KEY: optionalString,
    KAFKA_BROKERS: optionalString,
  })
  .transform((vars, ctx) => {
    if (Object.values(vars).every((value) => value === undefined)) {
      return;
    }
    const required = blogSummaryRequiredSchema.safeParse(vars);
    if (!required.success) {
      ctx.addIssue({
        code: "custom",
        message:
          "Blog-summary config is incomplete: set KAFKA_BROKERS, AIONLABS_API_KEY, " +
          "JIRA_SUMMARY_BASE_URL, JIRA_SUMMARY_EMAIL, JIRA_SUMMARY_API_TOKEN, and " +
          "JIRA_SUMMARY_PROJECT_KEY together, or none of them.",
      });
      return z.NEVER;
    }
    const { data } = required;
    return {
      aiApiKey: data.AIONLABS_API_KEY,
      brokers: data.KAFKA_BROKERS.split(",")
        .map((broker) => broker.trim())
        .filter((broker) => broker.length > 0),
      jira: {
        apiToken: data.JIRA_SUMMARY_API_TOKEN,
        baseUrl: data.JIRA_SUMMARY_BASE_URL,
        email: data.JIRA_SUMMARY_EMAIL,
        projectKey: data.JIRA_SUMMARY_PROJECT_KEY,
      },
    };
  });

const blogSummary = blogSummaryEnvSchema.parse(process.env);

/** Typed, deeply frozen application configuration. Import this; never read process.env directly. */
export const config = deepFreeze({
  // Bonus NHI Blog Summary secrets (AIonLabs key, Kafka brokers, and the Jira
  // service-account credentials), or undefined when the feature is off. Validated
  // as an all-or-none group above; secrets here are redacted in logs.
  blogSummary,
  constants: {
    // Refresh the Jira access token this many seconds before it actually
    // expires, so a call never goes out with an access token about to lapse.
    accessTokenRefreshSkewSeconds: 30,
    // AIonLabs (OpenAI-compatible) client for the blog-summary generation. The
    // API key comes from the environment; these are the tuning constants.
    ai: {
      baseUrl: "https://api.aionlabs.ai/v1",
      // Retry the completion POST on 429 only (ky). A rate-limited request was
      // rejected before processing, so retrying cannot duplicate work.
      maxRetries: 4,
      // Cap on completion tokens for the summary.
      maxTokens: 500,
      model: "aion-labs/aion-2.0",
      requestTimeoutMs: 30_000,
      // Low temperature: a factual summary, not creative writing.
      temperature: 0.2,
    },
    // Upper bound on a requested API key lifetime (10 years). The caller picks
    // the actual expiry when creating the key.
    apiKeyMaxExpiryDays: 3650,
    // Prefix on raw API keys, so a leaked key is recognizable in logs/scanners.
    apiKeyPrefix: "ih_",
    apiKeyRandomBytes: 32,
    // Server-side retry for idempotent read endpoints on a transient failure
    // (upstream Jira 5xx, or a Redis/lock blip). 3 attempts, full-jitter backoff
    // starting at 100ms. Creates are never retried here (non-idempotent).
    apiRetry: {
      attempts: 3,
      baseDelayMs: 100,
    },
    // Blog-summary ticket shaping (bonus).
    blogSummary: {
      // Prefixed onto the blog post title to form the Jira issue summary.
      titlePrefix: "NHI Blog Summary: ",
    },
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
      // Max issue keys per POST /issue/bulkfetch call (Jira rejects over 100).
      // Recent Tickets batches its candidate keys into calls of this size.
      bulkFetchMaxKeys: 100,
      // The identity (/me) endpoint.
      identityUrl: "https://api.atlassian.com/me",
      // Fields fetched live per Recent Tickets row: title, reporter, priority,
      // and status (priority/status shown only when the issue has them).
      issueDetailFields: ["summary", "reporter", "priority", "status"],
      // Retry budget: 4 retries (5 attempts total).
      maxRetries: 4,
      // Safety bound on how many pages the project search will walk (100 * 50 =
      // up to 5000 projects), so a huge workspace can't loop unboundedly.
      projectsMaxPages: 50,
      // Page size for the creatable-projects search (Jira caps this at 100).
      projectsPageSize: 100,
      // OAuth token exchange / refresh endpoint.
      tokenUrl: "https://auth.atlassian.com/oauth/token",
    },
    // Kafka wiring for the blog-summary consumer (bonus). Brokers come from the
    // environment; these name the topic and this consumer.
    kafka: {
      clientId: "identityhub-backend",
      consumerGroupId: "identityhub-blog-summary",
      topic: "nhi-blog-posts",
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
    // Recent Tickets is project-wide but each row is filtered through the acting
    // user's own Jira token (an issue they cannot see is dropped). Because that
    // filter runs after the DB read, we page candidates in batches (one bulk
    // Jira fetch per batch resolves and visibility-filters the whole batch) and
    // keep pulling until we have `recentTicketsLimit` visible rows or run out.
    // The max bounds how many rows a single request will scan.
    recentTicketsScanBatchSize: 20,
    recentTicketsScanMaxRows: 200,
    // Per-user distributed lock (redlock) guarding token refresh, so concurrent
    // requests (including across pods) don't each spend the same rotating
    // refresh token. Values map to redlock's Settings.
    refreshLock: {
      // Auto-extend the lock when it is within this many ms of expiring, so a
      // slow refresh round-trip never loses the lock mid-flight.
      extensionThresholdMs: 500,
      // Acquire attempts, spacing, and jitter while another request holds it.
      retryCount: 50,
      retryDelayMs: 100,
      retryJitterMs: 100,
      // Lock lifetime; comfortably longer than one token refresh round-trip.
      ttlSeconds: 10,
    },
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
