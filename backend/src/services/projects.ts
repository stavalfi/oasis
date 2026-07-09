/**
 * projects.ts
 *
 * Builds the list of creatable projects, each with its chosen issue type and
 * the fields the create form should render: every project-required field plus a
 * curated set of optional fields, excluding fields that have dedicated inputs or
 * are set automatically. Cached per user. Delivered with the project list so the
 * frontend can render and validate the form without extra round trips.
 */
import type { Assignee, FieldMeta, Project } from "../dto/types.ts";
import { assigneesResponseSchema, projectsResponseSchema } from "../dto/schemas.ts";
import { jiraClient } from "../jira/jira.ts";
import type { JiraFieldMeta } from "../jira/types.ts";
import { config } from "../config.ts";
import { Retry } from "../lib/retry.ts";
import { Cache } from "../redis/cache.ts";
import { JiraAccess } from "./jira-access.ts";
import type { FreshConnection } from "./jira-access.ts";

export class ProjectsService {
  /** Whether a createmeta field should appear in the dynamic form. */
  static #shouldRenderField(field: JiraFieldMeta): boolean {
    if (config.constants.excludedFieldIds.some((fieldId) => fieldId === field.fieldId)) {
      return false;
    }
    return (
      field.required ||
      config.constants.curatedOptionalFieldIds.some((fieldId) => fieldId === field.fieldId)
    );
  }

  /** Map Jira field metadata to the shared, frontend-facing field shape. */
  static #toFieldMeta(field: JiraFieldMeta): FieldMeta {
    return {
      ...(field.allowedValues === undefined ? {} : { allowedValues: field.allowedValues }),
      ...(field.itemsType === undefined ? {} : { itemsType: field.itemsType }),
      fieldId: field.fieldId,
      name: field.name,
      required: field.required,
      type: field.schemaType ?? "string",
    };
  }

  /**
   * Build one project's create form metadata (issue type plus the fields to
   * render). Returns undefined if the project exposes no creatable issue type,
   * so the caller can skip it (list) or turn it into a 404 (single lookup).
   */
  static async #buildProject({
    connection,
    projectKey,
    projectName,
  }: {
    connection: FreshConnection;
    projectKey: string;
    projectName: string;
  }): Promise<Project | undefined> {
    const issueTypes = await jiraClient.getIssueTypes({
      accessToken: connection.accessToken,
      cloudId: connection.cloudId,
      projectKey,
    });
    const issueType =
      issueTypes.find((type) => type.name === config.constants.preferredIssueTypeName) ??
      issueTypes[0];
    if (issueType === undefined) {
      return undefined;
    }
    const fields = await jiraClient.getIssueTypeFields({
      accessToken: connection.accessToken,
      cloudId: connection.cloudId,
      issueTypeId: issueType.id,
      projectKey,
    });
    return {
      fields: fields
        .filter((field) => ProjectsService.#shouldRenderField(field))
        .map((field) => ProjectsService.#toFieldMeta(field)),
      issueTypeId: issueType.id,
      issueTypeName: issueType.name,
      key: projectKey,
      name: projectName,
    };
  }

  /**
   * Load creatable projects with their issue type and dynamic fields (uncached).
   * A project with no creatable issue type is skipped.
   */
  static #load(userId: string): Promise<Project[]> {
    return JiraAccess.withConnection({
      operation: async (connection) => {
        const projects = await jiraClient.searchCreatableProjects({
          accessToken: connection.accessToken,
          cloudId: connection.cloudId,
        });
        const builtProjects = await Promise.all(
          projects.map((project) =>
            ProjectsService.#buildProject({
              connection,
              projectKey: project.key,
              projectName: project.name,
            }),
          ),
        );
        return builtProjects.filter((project): project is Project => project !== undefined);
      },
      userId,
    });
  }

  /**
   * Return the acting user's creatable projects, from cache when fresh.
   *
   * @param userId - the acting user.
   */
  public static getProjects(userId: string): Promise<Project[]> {
    return Retry.idempotent(() =>
      Cache.getOrLoad({
        key: Cache.keyForProjects(userId),
        load: () => ProjectsService.#load(userId),
        schema: projectsResponseSchema,
        ttlSeconds: config.constants.cache.meAndProjectsTtlSeconds,
      }),
    );
  }

  /** Load a project's assignable users (uncached). */
  static #loadAssignees({
    userId,
    projectKey,
  }: {
    userId: string;
    projectKey: string;
  }): Promise<Assignee[]> {
    return JiraAccess.withConnection({
      operation: async (connection) => {
        const users = await jiraClient.getAssignableUsers({
          accessToken: connection.accessToken,
          cloudId: connection.cloudId,
          projectKey,
        });
        return users.map((user) => ({
          accountId: user.accountId,
          displayName: user.displayName ?? user.accountId,
        }));
      },
      userId,
    });
  }

  /**
   * Return a project's assignable users for the assignee picker, from cache
   * when fresh (short TTL, so newly added users show up quickly).
   *
   * @param userId - the acting user.
   * @param projectKey - the project to list assignable users for.
   */
  public static getAssignees({
    userId,
    projectKey,
  }: {
    userId: string;
    projectKey: string;
  }): Promise<Assignee[]> {
    return Retry.idempotent(() =>
      Cache.getOrLoad({
        key: Cache.keyForAssignableUsers({ projectKey, userId }),
        load: () => ProjectsService.#loadAssignees({ projectKey, userId }),
        schema: assigneesResponseSchema,
        ttlSeconds: config.constants.cache.assignableUsersTtlSeconds,
      }),
    );
  }
}
