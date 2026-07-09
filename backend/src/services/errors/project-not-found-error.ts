/**
 * project-not-found-error.ts
 *
 * Thrown when a requested project is not available to the acting user (not
 * creatable, or no longer exists). The API layer maps this to 404, which also
 * avoids revealing whether the project exists for another tenant.
 */
export class ProjectNotFoundError extends Error {
  public constructor(projectKey: string) {
    super(`Project ${projectKey} is not available.`);
    this.name = "ProjectNotFoundError";
  }
}
