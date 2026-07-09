/**
 * retry.ts
 *
 * Server-side retry for idempotent read endpoints. Retries a recoverable
 * (transient) failure with jittered exponential backoff so the client receives a
 * final result instead of a blip. "Recoverable" means a retry can plausibly
 * help: an upstream Jira 5xx, or a Redis/lock blip (redlock ExecutionError).
 * User-input (400), not-found (404), auth/reconnect (401), and Jira 4xx errors
 * are terminal and rethrown immediately. Only wrap reads — never a
 * non-idempotent create, which a retry could duplicate.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { ExecutionError } from "@sesamecare-oss/redlock";
import { config } from "../config.ts";
import { JiraApiError } from "../jira/errors/jira-api-error.ts";

export class Retry {
  /** Whether a thrown error is a transient failure worth retrying. */
  static #isRecoverable(error: unknown): boolean {
    if (error instanceof JiraApiError) {
      // 4xx: Jira rejected our request (bad input/permission/auth) -> terminal.
      // 5xx: transient upstream failure -> retry.
      return error.status >= 500;
    }
    // redlock could not acquire the refresh lock (Redis unavailable/contended).
    return error instanceof ExecutionError;
  }

  /** Full-jitter exponential backoff for the given 1-based attempt. */
  static #delayMs(attempt: number): number {
    const exponential = config.constants.apiRetry.baseDelayMs * 2 ** (attempt - 1);
    return Math.round(exponential * Math.random());
  }

  /**
   * Run `operation`, retrying on recoverable failures up to
   * `constants.apiRetry.attempts` total tries. Rethrows immediately on a terminal
   * error, and rethrows the last error once attempts are exhausted.
   *
   * @param operation - an IDEMPOTENT unit of work (a read); never a create.
   */
  public static async idempotent<T>(operation: () => Promise<T>): Promise<T> {
    const { attempts } = config.constants.apiRetry;
    // Retry attempts before the last; a recoverable error waits then retries, a
    // terminal one propagates immediately.
    for (let attempt = 1; attempt < attempts; attempt++) {
      try {
        return await operation();
      } catch (error: unknown) {
        if (!Retry.#isRecoverable(error)) {
          throw error;
        }
        await sleep(Retry.#delayMs(attempt));
      }
    }
    // Final attempt: whatever it throws is the caller's error.
    return operation();
  }
}
