/**
 * jira-access.ts
 *
 * Resolves a ready-to-use Jira access token for a user. Two layers of refresh:
 * proactive (refresh when the stored access token has nearly expired) and
 * reactive (if Jira rejects a token mid-call with 401, refresh and retry once).
 * Refresh runs under a per-user distributed lock, re-reading the row after
 * acquiring it, so concurrent requests across pods don't each spend the same
 * rotating refresh token. Propagates RefreshTokenExpiredError (reconnect) and
 * NotConnectedError to the API layer.
 */
import { config } from "../config.ts";
import { JiraApiError } from "../jira/errors/jira-api-error.ts";
import { jiraClient } from "../jira/jira.ts";
import { JiraConnectionsModel } from "../models/jira-connections.ts";
import type { JiraConnection } from "../models/types.ts";
import { RedisLock } from "../redis/redis-lock.ts";
import { NotConnectedError } from "./errors/not-connected-error.ts";

/** A tenant's Jira site plus a currently-valid access token. */
export interface FreshConnection {
  cloudId: string;
  siteUrl: string;
  accessToken: string;
}

export class JiraAccess {
  /** The per-user refresh lock key. */
  static #lockKey(userId: string): string {
    return `jira_refresh_lock:${userId}`;
  }

  /** Whether the stored access token is still usable (not within the skew). */
  static #isFresh(connection: JiraConnection): boolean {
    const skewMs = config.constants.accessTokenRefreshSkewSeconds * 1000;
    return connection.accessTokenExpiresAt.getTime() - skewMs > Date.now();
  }

  /** Project a stored connection to the caller-facing shape. */
  static #toFresh(connection: JiraConnection): FreshConnection {
    return {
      accessToken: connection.accessToken,
      cloudId: connection.cloudId,
      siteUrl: connection.siteUrl,
    };
  }

  /** Read the user's connection or throw NotConnectedError. */
  static async #requireConnection(userId: string): Promise<JiraConnection> {
    const connection = await JiraConnectionsModel.findByUserId(userId);
    if (connection === undefined) {
      throw new NotConnectedError();
    }
    return connection;
  }

  /**
   * Refresh the user's tokens under the per-user lock. After acquiring the lock
   * we re-read the row: if another request/pod already refreshed (the stored
   * access token no longer matches the one we found unusable), we reuse theirs
   * instead of spending the now-rotated refresh token again.
   *
   * @param userId - the acting user.
   * @param staleAccessToken - the access token the caller found unusable.
   */
  static #refresh({
    userId,
    staleAccessToken,
  }: {
    userId: string;
    staleAccessToken: string;
  }): Promise<FreshConnection> {
    return RedisLock.withLock({
      key: JiraAccess.#lockKey(userId),
      routine: async () => {
        const connection = await JiraAccess.#requireConnection(userId);
        // Someone else refreshed while we waited for the lock, so reuse their
        // freshly-rotated tokens rather than re-spending the old refresh token.
        if (connection.accessToken !== staleAccessToken) {
          return JiraAccess.#toFresh(connection);
        }
        const newTokens = await jiraClient.exchangeRefreshToken(connection.refreshToken);
        await JiraConnectionsModel.updateTokens({
          accessToken: newTokens.accessToken,
          accessTokenExpiresAt: new Date(Date.now() + newTokens.expiresInSeconds * 1000),
          refreshToken: newTokens.refreshToken,
          userId,
        });
        return {
          accessToken: newTokens.accessToken,
          cloudId: connection.cloudId,
          siteUrl: connection.siteUrl,
        };
      },
    });
  }

  /**
   * Return the user's connection with a usable access token, refreshing
   * proactively (under the per-user lock) when the stored token is at or past
   * its skewed expiry.
   *
   * @param userId - the acting user.
   */
  static async #getFreshConnection(userId: string): Promise<FreshConnection> {
    const connection = await JiraAccess.#requireConnection(userId);
    if (JiraAccess.#isFresh(connection)) {
      return JiraAccess.#toFresh(connection);
    }
    return JiraAccess.#refresh({ staleAccessToken: connection.accessToken, userId });
  }

  /**
   * Run a Jira operation with a fresh access token, and if Jira rejects the
   * token mid-call (401), refresh reactively and retry the operation once. This
   * covers what proactive refresh cannot: clock skew, or a token invalidated
   * server-side before its stored expiry. The retry is bounded to one attempt.
   *
   * @param userId - the acting user.
   * @param operation - the Jira work to run with the resolved connection.
   */
  public static async withConnection<T>({
    userId,
    operation,
  }: {
    userId: string;
    operation: (connection: FreshConnection) => Promise<T>;
  }): Promise<T> {
    const connection = await JiraAccess.#getFreshConnection(userId);
    try {
      return await operation(connection);
    } catch (error: unknown) {
      if (error instanceof JiraApiError && error.status === 401) {
        const refreshed = await JiraAccess.#refresh({
          staleAccessToken: connection.accessToken,
          userId,
        });
        return operation(refreshed);
      }
      throw error;
    }
  }
}
