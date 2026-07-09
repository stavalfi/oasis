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
  // Page marker from Jira's paginated project search; true on the final page.
  isLast: z.boolean().optional(),
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
        schema: z.object({ items: z.string().optional(), type: z.string() }).optional(),
      }),
    )
    .optional(),
});

export const assignableUsersSchema = z.array(
  z.object({ accountId: z.string(), displayName: z.string().optional() }),
);

export const createdIssueSchema = z.object({ key: z.string() });

// The subset of Jira issue fields Recent Tickets renders (see
// config.constants.jira.issueDetailFields). Shared by the bulk-fetch response.
const issueDetailFieldsSchema = z
  .object({
    priority: z.object({ name: z.string().optional() }).nullable().optional(),
    reporter: z.object({ displayName: z.string().optional() }).nullable().optional(),
    status: z.object({ name: z.string().optional() }).nullable().optional(),
    summary: z.string().nullable().optional(),
  })
  .optional();

// POST /issue/bulkfetch response. Jira only returns issues the acting token can
// see; issues that are deleted or permission-denied are simply absent from
// `issues` (they surface, if at all, in a separate `issueErrors` list we ignore),
// so the presence of a key doubles as the Recent Tickets visibility filter.
export const bulkIssuesSchema = z.object({
  issues: z.array(z.object({ fields: issueDetailFieldsSchema, key: z.string() })).optional(),
});
