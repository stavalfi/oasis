/**
 * tickets.ts
 *
 * Create-finding and Recent Tickets business logic, shared by the UI and the
 * machine REST API. Create validates input against the project's createmeta
 * (required fields, length limits from config), maps curated/required field
 * values into Jira's shape, creates the issue, records our reference, and
 * invalidates the recent-tickets cache. Recent Tickets reads our references and
 * fetches current titles live from Jira. Both are scoped to the acting user.
 */
import type { CreateFindingRequest, CreateFindingResponse, Ticket } from "../dto/types.ts";
import { recentTicketsResponseSchema } from "../dto/schemas.ts";
import { jiraClient } from "../jira/jira.ts";
import type { JiraFieldMeta } from "../jira/types.ts";
import { config } from "../lib/config.ts";
import { TicketsModel } from "../models/tickets.ts";
import { Cache } from "../redis/cache.ts";
import { InvalidFindingError } from "./errors/invalid-finding-error.ts";
import { JiraAccess } from "./jira-access.ts";
import { ProjectNotFoundError } from "./errors/project-not-found-error.ts";

export class TicketsService {
  /** Whether a provided field value counts as present (non-empty). */
  static #isPresent(value: unknown): boolean {
    if (value === undefined || value === null || value === "") {
      return false;
    }
    return !(Array.isArray(value) && value.length === 0);
  }

  /** Convert a form value into the shape Jira expects for that field type. */
  static #toJiraValue({ field, value }: { field: JiraFieldMeta; value: unknown }): unknown {
    switch (field.schemaType) {
      case "user": {
        // Jira user fields (e.g. assignee) are set by account id.
        return { accountId: String(value) };
      }
      case "priority":
      case "option": {
        return { id: String(value) };
      }
      case "date":
      case "datetime": {
        return String(value);
      }
      case "array": {
        const items = Array.isArray(value) ? value : [value];
        if (field.fieldId === "labels") {
          return items.map(String);
        }
        return items.map((item) => ({ id: String(item) }));
      }
      default: {
        return String(value);
      }
    }
  }

  /** Validate title and description against the configured length limits. */
  static #validateBaseFields({ title, description }: { title: string; description: string }): void {
    if (title.trim().length === 0) {
      throw new InvalidFindingError("Title is required.");
    }
    if (title.length > config.constants.validation.titleMaxLength) {
      throw new InvalidFindingError(
        `Title must be ${config.constants.validation.titleMaxLength} characters or fewer (currently ${title.length}).`,
      );
    }
    if (description.trim().length === 0) {
      throw new InvalidFindingError("Description is required.");
    }
    if (description.length > config.constants.validation.descriptionMaxLength) {
      throw new InvalidFindingError(
        `Description must be ${config.constants.validation.descriptionMaxLength} characters or fewer (currently ${description.length}).`,
      );
    }
  }

  /**
   * Build Jira's `fields` payload for the required and curated fields, enforcing
   * that every required field has a value.
   */
  static #buildExtraFields({
    fields,
    provided,
  }: {
    fields: JiraFieldMeta[];
    provided: Record<string, unknown>;
  }): Record<string, unknown> {
    const extraFields: Record<string, unknown> = {};
    for (const field of fields) {
      const isExcluded = config.constants.excludedFieldIds.some(
        (fieldId) => fieldId === field.fieldId,
      );
      if (!isExcluded) {
        const value = provided[field.fieldId];
        if (TicketsService.#isPresent(value)) {
          extraFields[field.fieldId] = TicketsService.#toJiraValue({ field, value });
        } else if (field.required) {
          throw new InvalidFindingError(`${field.name} is required for this project.`);
        }
      }
    }
    return extraFields;
  }

  /** Resolve the project's create issue type (Task, or the first available). */
  static async #resolveIssueTypeId({
    accessToken,
    cloudId,
    projectKey,
  }: {
    accessToken: string;
    cloudId: string;
    projectKey: string;
  }): Promise<string> {
    const issueTypes = await jiraClient.getIssueTypes({ accessToken, cloudId, projectKey });
    const issueType =
      issueTypes.find((type) => type.name === config.constants.preferredIssueTypeName) ??
      issueTypes[0];
    if (issueType === undefined) {
      throw new ProjectNotFoundError(projectKey);
    }
    return issueType.id;
  }

  /**
   * Create a finding ticket from validated input. Resolves the project's issue
   * type and field metadata, validates, creates the issue, records our
   * reference, and invalidates the recent-tickets cache. Returns the new issue
   * key and URL.
   *
   * @param userId - the acting user.
   * @param input - the validated request body.
   */
  public static async createFinding({
    userId,
    input,
  }: {
    userId: string;
    input: CreateFindingRequest;
  }): Promise<CreateFindingResponse> {
    TicketsService.#validateBaseFields({ description: input.description, title: input.title });

    const connection = await JiraAccess.getFreshConnection(userId);
    const issueTypeId = await TicketsService.#resolveIssueTypeId({
      accessToken: connection.accessToken,
      cloudId: connection.cloudId,
      projectKey: input.projectKey,
    });

    const fieldMeta = await jiraClient.getIssueTypeFields({
      accessToken: connection.accessToken,
      cloudId: connection.cloudId,
      issueTypeId,
      projectKey: input.projectKey,
    });
    const extraFields = TicketsService.#buildExtraFields({
      fields: fieldMeta,
      provided: input.fields ?? {},
    });

    const created = await jiraClient.createIssue({
      accessToken: connection.accessToken,
      cloudId: connection.cloudId,
      description: input.description,
      extraFields,
      issueTypeId,
      projectKey: input.projectKey,
      title: input.title,
    });

    await TicketsModel.insert({
      jiraIssueKey: created.key,
      projectKey: input.projectKey,
      userId,
    });
    await Cache.invalidate(Cache.keyForRecentTickets({ projectKey: input.projectKey, userId }));

    return { key: created.key, url: `${connection.siteUrl}/browse/${created.key}` };
  }

  /** Load recent app-created tickets for a project with live titles (uncached). */
  static async #loadRecentTickets({
    userId,
    projectKey,
  }: {
    userId: string;
    projectKey: string;
  }): Promise<Ticket[]> {
    const connection = await JiraAccess.getFreshConnection(userId);
    const rows = await TicketsModel.listRecent({
      limit: config.constants.recentTicketsLimit,
      projectKey,
      userId,
    });
    return Promise.all(
      rows.map(async (row): Promise<Ticket> => {
        const title = await jiraClient.getIssueSummary({
          accessToken: connection.accessToken,
          cloudId: connection.cloudId,
          issueKey: row.jira_issue_key,
        });
        return {
          createdAt: row.created_at.toISOString(),
          key: row.jira_issue_key,
          title: title ?? row.jira_issue_key,
          url: `${connection.siteUrl}/browse/${row.jira_issue_key}`,
        };
      }),
    );
  }

  /**
   * Return the acting user's recent app-created tickets for a project, from
   * cache when fresh.
   *
   * @param userId - the acting user.
   * @param projectKey - the selected project.
   */
  public static getRecentTickets({
    userId,
    projectKey,
  }: {
    userId: string;
    projectKey: string;
  }): Promise<Ticket[]> {
    return Cache.getOrLoad({
      key: Cache.keyForRecentTickets({ projectKey, userId }),
      load: () => TicketsService.#loadRecentTickets({ projectKey, userId }),
      schema: recentTicketsResponseSchema,
      ttlSeconds: config.constants.cache.recentTicketsTtlSeconds,
    });
  }
}
