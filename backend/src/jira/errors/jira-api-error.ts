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
  /** Jira's own error text (e.g. which field it rejected), when available. */
  public readonly detail: string | undefined;

  public constructor({
    operation,
    status,
    message,
    detail,
  }: {
    operation: string;
    status: number;
    message: string;
    detail?: string | undefined;
  }) {
    super(message);
    this.name = "JiraApiError";
    this.operation = operation;
    this.status = status;
    this.detail = detail;
  }
}
