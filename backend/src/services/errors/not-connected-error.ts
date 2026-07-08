/**
 * not-connected-error.ts
 *
 * Thrown when an action needs the user's Jira connection but none exists (the
 * user has a session but never completed, or has lost, the Jira OAuth link).
 * The API layer maps this to a reconnect-required response.
 */
export class NotConnectedError extends Error {
  public constructor() {
    super("No Jira connection for this user; reconnect required.");
    this.name = "NotConnectedError";
  }
}
