/**
 * projects.ts
 *
 * Builds the list of creatable projects, each with its chosen issue type and
 * the fields the create form should render: every project-required field plus a
 * curated set of optional fields, excluding fields that have dedicated inputs or
 * are set automatically. Cached per user. Delivered with the project list so the
 * frontend can render and validate the form without extra round trips.
 */
import { type FieldMeta, type Project } from "../dto/types.ts";
import { projectsResponseSchema } from "../dto/schemas.ts";
import { jiraClient } from "../jira/jira.ts";
import { type JiraFieldMeta } from "../jira/types.ts";
import { config } from "../lib/config.ts";
import { Cache } from "../redis/cache.ts";
import { JiraAccess } from "./jira-access.ts";

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
      fieldId: field.fieldId,
      name: field.name,
      required: field.required,
      type: field.schemaType ?? "string",
    };
  }

  /**
   * Load creatable projects with their issue type and dynamic fields (uncached).
   * A project with no creatable issue type is skipped.
   */
  static async #load(userId: string): Promise<Project[]> {
    const connection = await JiraAccess.getFreshConnection(userId);
    const projects = await jiraClient.searchCreatableProjects({
      accessToken: connection.accessToken,
      cloudId: connection.cloudId,
    });

    const builtProjects = await Promise.all(
      projects.map(async (project): Promise<Project | undefined> => {
        const issueTypes = await jiraClient.getIssueTypes({
          accessToken: connection.accessToken,
          cloudId: connection.cloudId,
          projectKey: project.key,
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
          projectKey: project.key,
        });
        return {
          fields: fields
            .filter((field) => ProjectsService.#shouldRenderField(field))
            .map((field) => ProjectsService.#toFieldMeta(field)),
          issueTypeId: issueType.id,
          issueTypeName: issueType.name,
          key: project.key,
          name: project.name,
        };
      }),
    );

    return builtProjects.filter((project): project is Project => project !== undefined);
  }

  /**
   * Return the acting user's creatable projects, from cache when fresh.
   *
   * @param userId - the acting user.
   */
  public static getProjects(userId: string): Promise<Project[]> {
    return Cache.getOrLoad({
      key: Cache.keyForProjects(userId),
      load: () => ProjectsService.#load(userId),
      schema: projectsResponseSchema,
      ttlSeconds: config.constants.cache.meAndProjectsTtlSeconds,
    });
  }
}
