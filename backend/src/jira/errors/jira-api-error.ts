/**
 * jira-api-error.ts
 *
 * Error thrown by JiraClient when Atlassian returns a non-success status for a
 * wrapped call. Carries the HTTP status and operation so services can map it to
 * the right response (typically 502).
 */
export class JiraApiError extends Error {
  public readonly status: number;
  public readonly operation: string;

  public constructor({
    operation,
    status,
    message,
  }: {
    operation: string;
    status: number;
    message: string;
  }) {
    super(message);
    this.name = "JiraApiError";
    this.operation = operation;
    this.status = status;
  }
}
