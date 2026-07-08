/**
 * schemas.ts
 *
 * Zod schemas for the API request/response contract. These validate every route
 * (via @hono/zod-openapi) and generate the OpenAPI document. Timestamps cross
 * the wire as ISO strings. The frontend mirrors these shapes as plain types
 * (frontend/src/api/types.ts) and does not depend on zod.
 */
import { z } from "zod";

/** Current user and their connected Jira site. */
export const meResponseSchema = z.object({
  accountId: z.string(),
  email: z.string(),
  siteName: z.string(),
  siteUrl: z.string(),
});

/** An allowed value for an enum-like field (from createmeta). */
export const allowedValueSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  value: z.string().optional(),
});

/** A field the create form should render (required or curated-optional). */
export const fieldMetaSchema = z.object({
  allowedValues: z.array(allowedValueSchema).optional(),
  fieldId: z.string(),
  name: z.string(),
  required: z.boolean(),
  type: z.string(),
});

/** A creatable project with its chosen issue type and dynamic fields. */
export const projectSchema = z.object({
  fields: z.array(fieldMetaSchema),
  issueTypeId: z.string(),
  issueTypeName: z.string(),
  key: z.string(),
  name: z.string(),
});

export const projectsResponseSchema = z.array(projectSchema);

/** A recent app-created ticket (title fetched live from Jira). */
export const ticketSchema = z.object({
  createdAt: z.string(),
  key: z.string(),
  title: z.string(),
  url: z.string(),
});

export const recentTicketsResponseSchema = z.array(ticketSchema);

/** Body for creating a finding, from the UI or the machine REST API. */
export const createFindingRequestSchema = z.object({
  description: z.string(),
  fields: z.record(z.string(), z.unknown()).optional(),
  projectKey: z.string(),
  title: z.string(),
});

/** Result of creating a finding. */
export const createFindingResponseSchema = z.object({
  key: z.string(),
  url: z.string(),
});

/** API key metadata (never the raw key). */
export const apiKeyMetadataSchema = z.object({
  createdAt: z.string(),
  expiresAt: z.string(),
  id: z.string(),
  lastUsedAt: z.string().optional(),
  name: z.string(),
});

export const apiKeysResponseSchema = z.array(apiKeyMetadataSchema);

/** Body for creating an API key (just a human label). */
export const createApiKeyRequestSchema = z.object({
  name: z.string(),
});

/** Result of creating an API key: metadata plus the raw key, shown once. */
export const createApiKeyResponseSchema = apiKeyMetadataSchema.extend({
  key: z.string(),
});

/** Uniform error body returned by the API. */
export const errorResponseSchema = z.object({
  message: z.string(),
  requestId: z.string().optional(),
});
