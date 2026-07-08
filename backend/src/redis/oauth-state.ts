/**
 * oauth-state.ts
 *
 * Stores the OAuth 2.0 CSRF `state` value in Redis with a short TTL. The state
 * is single-use: the login route stores it, and the callback consumes it
 * atomically (GETDEL), so a state cannot be replayed. Part of the redis choke
 * point.
 */
import { config } from "../lib/config.ts";
import { redis } from "./client.ts";

export class OAuthStateStore {
  static #keyFor(state: string): string {
    return `oauth_state:${state}`;
  }

  /** Store a freshly generated state value with the configured TTL. */
  public static async store(state: string): Promise<void> {
    await redis.set(
      OAuthStateStore.#keyFor(state),
      "1",
      "EX",
      config.constants.oauthStateTtlSeconds,
    );
  }

  /**
   * Atomically consume a state value. Returns true only if it existed (was
   * issued by us and not yet used), deleting it in the same step.
   *
   * @param state - the state returned on the OAuth callback.
   */
  public static async consume(state: string): Promise<boolean> {
    const existing = await redis.getdel(OAuthStateStore.#keyFor(state));
    return existing !== null;
  }
}
