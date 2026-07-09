/**
 * tickets.ts
 *
 * Create-finding and Recent Tickets business logic, shared by the UI and the
 * machine REST API. Create validates input against the project's createmeta
 * (required fields, length limits from config), maps curated/required field
 * values into Jira's shape, creates the issue, records our reference, and
 * invalidates the recent-tickets cache. Recent Tickets reads our references
 * (scoped to the selected project, across all app users) and fetches each
 * issue's current title, reporter, priority, and status live from Jira.
 */
import { config } from "../config.ts";
import { recentTicketsResponseSchema } from "../dto/schemas.ts";
import type { CreateFindingRequest, CreateFindingResponse, Ticket } from "../dto/types.ts";
import { jiraClient } from "../jira/jira.ts";
import type { JiraFieldMeta } from "../jira/types.ts";
import { Retry } from "../lib/retry.ts";
import { TicketsModel } from "../models/tickets.ts";
import { Cache } from "../redis/cache.ts";
import { InvalidFindingError, ProjectNotFoundError } from "./errors/index.ts";
import { JiraAccess } from "./jira-access.ts";

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
      case "number": {
        // Jira number fields must be a real number, not a string.
        return Number(value);
      }
      case "array": {
        const items = Array.isArray(value) ? value : [value];
        if (field.fieldId === "labels" || field.itemsType === "string") {
          return items.map(String);
        }
        if (field.itemsType === "user") {
          // Multi-user picker (e.g. an "Owner" field): array of account ids.
          return items.map((item) => ({ accountId: String(item) }));
        }
        // option / version / component / group arrays: array of { id }.
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
  public static createFinding({
    userId,
    input,
  }: {
    userId: string;
    input: CreateFindingRequest;
  }): Promise<CreateFindingResponse> {
    TicketsService.#validateBaseFields({ description: input.description, title: input.title });

    return JiraAccess.withConnection({
      operation: async (connection) => {
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
        // Field id -> human name, so a Jira field error names the field the user
        // sees ("Budget Amount") instead of the raw id ("customfield_10121").
        const fieldNames = Object.fromEntries(
          fieldMeta.map((field) => [field.fieldId, field.name]),
        );

        const created = await jiraClient.createIssue({
          accessToken: connection.accessToken,
          cloudId: connection.cloudId,
          description: input.description,
          extraFields,
          fieldNames,
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
      },
      userId,
    });
  }

  /** Load recent app-created tickets for a project with live titles (uncached). */
  static #loadRecentTickets({
    userId,
    projectKey,
  }: {
    userId: string;
    projectKey: string;
  }): Promise<Ticket[]> {
    return JiraAccess.withConnection({
      operation: async (connection) => {
        // Project-scoped: every app-created ticket for this project, regardless of
        // which app user created it. Titles + reporter are read live from Jira.
        const rows = await TicketsModel.listRecent({
          limit: config.constants.recentTicketsLimit,
          projectKey,
        });
        const tickets = await Promise.all(
          rows.map(async (row): Promise<Ticket | undefined> => {
            const details = await jiraClient.getIssueDetails({
              accessToken: connection.accessToken,
              cloudId: connection.cloudId,
              issueKey: row.jira_issue_key,
            });
            // Dropped if the issue no longer exists in Jira (deleted) or isn't
            // visible from this connection, so the list never shows a dead link.
            if (details === undefined) {
              return undefined;
            }
            return {
              createdAt: row.created_at.toISOString(),
              key: row.jira_issue_key,
              reporter: details.reporter ?? "Unknown",
              title: details.title ?? row.jira_issue_key,
              url: `${connection.siteUrl}/browse/${row.jira_issue_key}`,
              ...(details.priority === undefined ? {} : { priority: details.priority }),
              ...(details.status === undefined ? {} : { status: details.status }),
            };
          }),
        );
        return tickets.filter((ticket): ticket is Ticket => ticket !== undefined);
      },
      userId,
    });
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
    return Retry.idempotent(() =>
      Cache.getOrLoad({
        key: Cache.keyForRecentTickets({ projectKey, userId }),
        load: () => TicketsService.#loadRecentTickets({ projectKey, userId }),
        schema: recentTicketsResponseSchema,
        ttlSeconds: config.constants.cache.recentTicketsTtlSeconds,
      }),
    );
  }
}
