/**
 * jira.ts
 *
 * The single class through which ALL Atlassian traffic flows. It wraps the
 * generated Jira REST operations and the few hand-written OAuth calls that the
 * spec does not cover, so every Jira call, its auth, and its transport live in
 * one auditable place. Nothing else in the backend talks to Atlassian.
 *
 * Transport: direct `fetch` is banned repo-wide, so the generated client's
 * transport is overridden with `ky`, which honors `Retry-After` on 429/503 for
 * idempotent GETs and retries the create-issue POST on 429 only (a rate-limited
 * request was rejected before processing, so retrying cannot duplicate).
 */
import ky from "ky";
import { createClient, createConfig } from "#jira/client/index.ts";
import type { Client } from "#jira/client/index.ts";
import {
  createIssue,
  getCreateIssueMetaIssueTypeId,
  getCreateIssueMetaIssueTypes,
  getIssue,
  searchProjects,
} from "#jira/index.ts";
import { config } from "../lib/config.ts";
import { JiraApiError } from "./errors/jira-api-error.ts";
import { RefreshTokenExpiredError } from "./errors/refresh-token-expired-error.ts";
import {
  createdIssueSchema,
  fieldsSchema,
  identitySchema,
  issueSummarySchema,
  issueTypesSchema,
  projectsSchema,
  resourcesSchema,
  tokensSchema,
} from "./schemas.ts";
import type {
  AccessibleResource,
  JiraFieldMeta,
  JiraIdentity,
  JiraIssueTypeSummary,
  JiraProjectSummary,
  JiraTokens,
} from "./types.ts";

type KyInstance = ReturnType<typeof ky.create>;

export class JiraClient {
  /** ky for idempotent GETs: retry on 429 and 503, honoring Retry-After. */
  readonly #getKy: KyInstance;
  /** ky for the create POST: retry on 429 only, never 5xx (no duplicate risk). */
  readonly #postKy: KyInstance;
  /** Generated Jira REST client, transport-bound to #getKy. */
  readonly #jiraClient: Client;

  /** Base URL for authenticated Jira REST calls (the cloud id selects the site). */
  static #jiraApiBase(cloudId: string): string {
    return `${config.constants.jira.apiBaseUrl}/${cloudId}`;
  }

  /** Convert plain text to a minimal Atlassian Document Format document. */
  static #toAtlassianDocumentFormat(text: string): unknown {
    return {
      content: text.length === 0 ? [] : [{ content: [{ text, type: "text" }], type: "paragraph" }],
      type: "doc",
      version: 1,
    };
  }

  public constructor() {
    this.#getKy = ky.create({
      retry: {
        afterStatusCodes: [429, 503],
        limit: config.constants.jira.maxRetries,
        methods: ["get"],
        statusCodes: [429, 503],
      },
      throwHttpErrors: false,
    });
    this.#postKy = ky.create({
      retry: {
        afterStatusCodes: [429],
        limit: config.constants.jira.maxRetries,
        methods: ["post"],
        statusCodes: [429],
      },
      throwHttpErrors: false,
    });
    // Bind the generated client's transport to the GET-retry ky. The create
    // call overrides this per-request with the POST-only-429 ky.
    this.#jiraClient = createClient(
      createConfig({ fetch: (input, init) => this.#getKy(input, init) }),
    );
  }

  /** Exchange an authorization code for tokens (first login / re-consent). */
  public async exchangeCode(code: string): Promise<JiraTokens> {
    const response = await this.#postKy(config.constants.jira.tokenUrl, {
      json: {
        client_id: config.jira.clientId,
        client_secret: config.jira.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: config.server.oauthCallbackUrl,
      },
    });
    if (!response.ok) {
      throw new JiraApiError({
        message: "Token exchange failed.",
        operation: "token",
        status: response.status,
      });
    }
    const body: unknown = await response.json();
    const tokens = tokensSchema.parse(body);
    return {
      accessToken: tokens.access_token,
      expiresInSeconds: tokens.expires_in,
      refreshToken: tokens.refresh_token,
    };
  }

  /**
   * Refresh the access token using the (rotating) refresh token. Throws
   * {@link RefreshTokenExpiredError} on invalid_grant so the caller can force a
   * reconnect.
   */
  public async refreshTokens(refreshToken: string): Promise<JiraTokens> {
    const response = await this.#postKy(config.constants.jira.tokenUrl, {
      json: {
        client_id: config.jira.clientId,
        client_secret: config.jira.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      },
    });
    if (response.status === 400) {
      throw new RefreshTokenExpiredError();
    }
    if (!response.ok) {
      throw new JiraApiError({
        message: "Token refresh failed.",
        operation: "refresh",
        status: response.status,
      });
    }
    const body: unknown = await response.json();
    const tokens = tokensSchema.parse(body);
    return {
      accessToken: tokens.access_token,
      expiresInSeconds: tokens.expires_in,
      refreshToken: tokens.refresh_token,
    };
  }

  /** List the Jira sites the user consented to (accessible-resources). */
  public async listAccessibleResources(accessToken: string): Promise<AccessibleResource[]> {
    const response = await this.#getKy(config.constants.jira.accessibleResourcesUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new JiraApiError({
        message: "Failed to list accessible resources.",
        operation: "accessible_resources",
        status: response.status,
      });
    }
    const body: unknown = await response.json();
    return resourcesSchema.parse(body).map((resource) => ({
      cloudId: resource.id,
      siteName: resource.name ?? resource.url,
      siteUrl: resource.url,
    }));
  }

  /** Read the acting user's Atlassian identity (/me). */
  public async getIdentity(accessToken: string): Promise<JiraIdentity> {
    const response = await this.#getKy(config.constants.jira.identityUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new JiraApiError({
        message: "Failed to read identity.",
        operation: "identity",
        status: response.status,
      });
    }
    const body: unknown = await response.json();
    const identity = identitySchema.parse(body);
    return { accountId: identity.account_id, email: identity.email };
  }

  /** List projects the acting user can create issues in. */
  public async searchCreatableProjects({
    cloudId,
    accessToken,
  }: {
    cloudId: string;
    accessToken: string;
  }): Promise<JiraProjectSummary[]> {
    const { data, response } = await searchProjects({
      baseUrl: JiraClient.#jiraApiBase(cloudId),
      client: this.#jiraClient,
      headers: { Authorization: `Bearer ${accessToken}` },
      query: { action: "create", maxResults: config.constants.jira.projectsPageSize },
    });
    if (data === undefined) {
      throw new JiraApiError({
        message: "Failed to search projects.",
        operation: "projects",
        status: response?.status ?? 0,
      });
    }
    return (projectsSchema.parse(data).values ?? []).map((project) => ({
      id: project.id,
      key: project.key,
      name: project.name,
    }));
  }

  /** List issue types available for creation in a project. */
  public async getIssueTypes({
    cloudId,
    accessToken,
    projectKey,
  }: {
    cloudId: string;
    accessToken: string;
    projectKey: string;
  }): Promise<JiraIssueTypeSummary[]> {
    const { data, response } = await getCreateIssueMetaIssueTypes({
      baseUrl: JiraClient.#jiraApiBase(cloudId),
      client: this.#jiraClient,
      headers: { Authorization: `Bearer ${accessToken}` },
      path: { projectIdOrKey: projectKey },
    });
    if (data === undefined) {
      throw new JiraApiError({
        message: "Failed to read issue types.",
        operation: "createmeta",
        status: response?.status ?? 0,
      });
    }
    return (issueTypesSchema.parse(data).issueTypes ?? []).map((issueType) => ({
      id: issueType.id,
      name: issueType.name,
    }));
  }

  /** Read the required/optional field metadata for a project's issue type. */
  public async getIssueTypeFields({
    cloudId,
    accessToken,
    projectKey,
    issueTypeId,
  }: {
    cloudId: string;
    accessToken: string;
    projectKey: string;
    issueTypeId: string;
  }): Promise<JiraFieldMeta[]> {
    const { data, response } = await getCreateIssueMetaIssueTypeId({
      baseUrl: JiraClient.#jiraApiBase(cloudId),
      client: this.#jiraClient,
      headers: { Authorization: `Bearer ${accessToken}` },
      path: { issueTypeId, projectIdOrKey: projectKey },
    });
    if (data === undefined) {
      throw new JiraApiError({
        message: "Failed to read field metadata.",
        operation: "createmeta",
        status: response?.status ?? 0,
      });
    }
    return (fieldsSchema.parse(data).fields ?? []).map((field) => ({
      allowedValues: field.allowedValues,
      fieldId: field.fieldId,
      name: field.name,
      required: field.required,
      schemaType: field.schema?.type,
    }));
  }

  /**
   * Create an issue. Title maps to `summary`, description is converted to ADF,
   * and `extraFields` (already in Jira's shape) are merged in. Returns the new
   * issue key. Uses the POST-only-429 transport so a rate-limit retry can never
   * create a duplicate.
   */
  public async createIssue({
    cloudId,
    accessToken,
    projectKey,
    issueTypeId,
    title,
    description,
    extraFields,
  }: {
    cloudId: string;
    accessToken: string;
    projectKey: string;
    issueTypeId: string;
    title: string;
    description: string;
    extraFields: Record<string, unknown>;
  }): Promise<{ key: string }> {
    const { data, response } = await createIssue({
      baseUrl: JiraClient.#jiraApiBase(cloudId),
      body: {
        fields: {
          description: JiraClient.#toAtlassianDocumentFormat(description),
          issuetype: { id: issueTypeId },
          project: { key: projectKey },
          summary: title,
          ...extraFields,
        },
      },
      client: this.#jiraClient,
      fetch: (input, init) => this.#postKy(input, init),
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (data === undefined) {
      throw new JiraApiError({
        message: "Failed to create issue.",
        operation: "create_issue",
        status: response?.status ?? 0,
      });
    }
    return { key: createdIssueSchema.parse(data).key };
  }

  /** Read an issue's current summary (for the live Recent Tickets title). */
  public async getIssueSummary({
    cloudId,
    accessToken,
    issueKey,
  }: {
    cloudId: string;
    accessToken: string;
    issueKey: string;
  }): Promise<string | undefined> {
    const { data, response } = await getIssue({
      baseUrl: JiraClient.#jiraApiBase(cloudId),
      client: this.#jiraClient,
      headers: { Authorization: `Bearer ${accessToken}` },
      path: { issueIdOrKey: issueKey },
      query: { fields: [...config.constants.jira.issueSummaryFields] },
    });
    if (data === undefined) {
      throw new JiraApiError({
        message: "Failed to read issue.",
        operation: "get_issue",
        status: response?.status ?? 0,
      });
    }
    return issueSummarySchema.parse(data).fields?.summary ?? undefined;
  }
}

/** The single shared Jira client instance. */
export const jiraClient = new JiraClient();
