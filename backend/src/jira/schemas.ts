/**
 * schemas.ts
 *
 * Zod schemas that validate the parts of Atlassian responses JiraClient
 * consumes. Parsing responses through these (rather than trusting the raw
 * generated types) keeps the client robust to unexpected shapes and yields
 * clean, narrow domain values.
 */
import { z } from "zod";

export const tokensSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string(),
});

export const resourcesSchema = z.array(
  z.object({ id: z.string(), name: z.string().optional(), url: z.string() }),
);

export const identitySchema = z.object({ account_id: z.string(), email: z.string() });

export const projectsSchema = z.object({
  values: z.array(z.object({ id: z.string(), key: z.string(), name: z.string() })).optional(),
});

export const issueTypesSchema = z.object({
  issueTypes: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
});

export const fieldsSchema = z.object({
  fields: z
    .array(
      z.object({
        allowedValues: z
          .array(
            z.object({
              id: z.string().optional(),
              name: z.string().optional(),
              value: z.string().optional(),
            }),
          )
          .optional(),
        fieldId: z.string(),
        name: z.string(),
        required: z.boolean(),
        schema: z.object({ type: z.string() }).optional(),
      }),
    )
    .optional(),
});

export const createdIssueSchema = z.object({ key: z.string() });

export const issueSummarySchema = z.object({
  fields: z.object({ summary: z.string().nullable().optional() }).optional(),
});
