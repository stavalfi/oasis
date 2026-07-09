/**
 * refresh-token-expired-error.ts
 *
 * Error thrown by JiraClient when a token refresh fails with invalid_grant (the
 * refresh token has expired, ~90 days). Services translate this into a
 * reconnect-required response that restarts the OAuth consent flow.
 */
export class RefreshTokenExpiredError extends Error {
  public constructor() {
    super("Jira refresh token expired; reconnect required.");
    this.name = "RefreshTokenExpiredError";
  }
}
