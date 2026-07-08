/**
 * domain-errors.ts
 *
 * Re-exports the domain error classes the HTTP error handler maps to statuses,
 * grouping them behind one import so the handler stays under the module
 * dependency limit and has a single place to see every mapped error.
 */
export { JiraApiError } from "../jira/errors/jira-api-error.ts";
export { RefreshTokenExpiredError } from "../jira/errors/refresh-token-expired-error.ts";
export { InvalidFindingError } from "../services/errors/invalid-finding-error.ts";
export { NotConnectedError } from "../services/errors/not-connected-error.ts";
export { ProjectNotFoundError } from "../services/errors/project-not-found-error.ts";
