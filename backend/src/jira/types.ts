/**
 * types.ts
 *
 * Domain types for the Jira layer: the shapes JiraClient exposes to services,
 * deliberately decoupled from the (large, generated) Atlassian response types.
 */

/** OAuth tokens as returned by the Atlassian token endpoint. */
export interface JiraTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

/** A Jira site the user consented to, from accessible-resources. */
export interface AccessibleResource {
  cloudId: string;
  siteUrl: string;
  siteName: string;
}

/** The acting user's Atlassian identity, from /me. */
export interface JiraIdentity {
  accountId: string;
  email: string;
}

/** A project the user can create issues in. */
export interface JiraProjectSummary {
  id: string;
  key: string;
  name: string;
}

/** An issue type available in a project. */
export interface JiraIssueTypeSummary {
  id: string;
  name: string;
}

/** A user who can be assigned issues in a project (assignable/search). */
export interface JiraAssignableUser {
  accountId: string;
  displayName: string | undefined;
}

/** An allowed value for an enum-like field. */
export interface JiraAllowedValue {
  id?: string | undefined;
  value?: string | undefined;
  name?: string | undefined;
}

/** Field metadata from createmeta, used to render and validate the form. */
export interface JiraFieldMeta {
  fieldId: string;
  name: string;
  required: boolean;
  schemaType: string | undefined;
  /** For array fields, the element type (e.g. "user", "option", "string"). */
  itemsType: string | undefined;
  allowedValues: JiraAllowedValue[] | undefined;
}
