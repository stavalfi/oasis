/**
 * jira-access.ts
 *
 * Resolves a ready-to-use Jira access token for a user, refreshing proactively
 * when the stored access token has (nearly) expired. This is where the
 * "transparent refresh" behavior lives: callers get a fresh token and never see
 * the refresh. Propagates RefreshTokenExpiredError (reconnect) and
 * NotConnectedError to the API layer.
 */
import { jiraClient } from "../jira/jira.ts";
import { config } from "../lib/config.ts";
import { JiraConnectionsModel } from "../models/jira-connections.ts";
import { NotConnectedError } from "./errors/not-connected-error.ts";

/** A tenant's Jira site plus a currently-valid access token. */
export interface FreshConnection {
  cloudId: string;
  siteUrl: string;
  accessToken: string;
}

export class JiraAccess {
  /**
   * Return the user's Jira connection with a valid access token, refreshing (and
   * persisting the rotated tokens) if the current one is at or past its skewed
   * expiry.
   *
   * @param userId - the acting user.
   */
  public static async getFreshConnection(userId: string): Promise<FreshConnection> {
    const connection = await JiraConnectionsModel.findByUserId(userId);
    if (connection === undefined) {
      throw new NotConnectedError();
    }

    const skewMs = config.constants.accessTokenRefreshSkewSeconds * 1000;
    const isStillFresh = connection.accessTokenExpiresAt.getTime() - skewMs > Date.now();
    if (isStillFresh) {
      return {
        accessToken: connection.accessToken,
        cloudId: connection.cloudId,
        siteUrl: connection.siteUrl,
      };
    }

    const refreshedTokens = await jiraClient.refreshTokens(connection.refreshToken);
    const accessTokenExpiresAt = new Date(Date.now() + refreshedTokens.expiresInSeconds * 1000);
    await JiraConnectionsModel.updateTokens({
      accessToken: refreshedTokens.accessToken,
      accessTokenExpiresAt,
      refreshToken: refreshedTokens.refreshToken,
      userId,
    });
    return {
      accessToken: refreshedTokens.accessToken,
      cloudId: connection.cloudId,
      siteUrl: connection.siteUrl,
    };
  }
}
