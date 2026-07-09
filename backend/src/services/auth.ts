/**
 * auth.ts
 *
 * Login/session business logic. Builds the Atlassian authorize URL (with a
 * single-use CSRF state), handles the OAuth callback (exchange tokens, resolve
 * the tenant site and identity, persist the user/connection, mint a session),
 * validates sessions with rolling expiry, and logs out. Orchestrates the jira
 * client, models, and redis; holds no HTTP concerns (those live in the api
 * layer).
 */
import { jiraClient } from "../jira/jira.ts";
import { config } from "../config.ts";
import { Tokens } from "../lib/tokens.ts";
import { JiraConnectionsModel } from "../models/jira-connections.ts";
import { SessionsModel } from "../models/sessions.ts";
import { UsersModel } from "../models/users.ts";
import { OAuthStateStore } from "../redis/oauth-state.ts";

/** The result of a successful login: the session to set as a cookie. */
export interface EstablishedSession {
  sessionId: string;
  expiresAt: Date;
}

export class AuthService {
  /**
   * Build the Atlassian authorize URL and persist a single-use CSRF state. The
   * caller redirects the browser to the returned URL.
   */
  public static async buildAuthorizeUrl(): Promise<string> {
    const state = Tokens.generateOpaqueToken(config.constants.stateRandomBytes);
    await OAuthStateStore.store(state);
    const params = new URLSearchParams({
      audience: config.constants.oauth.audience,
      client_id: config.jira.clientId,
      redirect_uri: config.server.oauthCallbackUrl,
      response_type: "code",
      scope: config.constants.oauth.scopes,
      state,
    });
    return `${config.constants.oauth.authorizeUrl}?${params.toString()}`;
  }

  /**
   * Handle the OAuth callback: verify the state, exchange the code, resolve the
   * tenant site and identity, persist the user and connection, and create a
   * session. Throws if the state is invalid or no Jira site was granted.
   *
   * @param code - the authorization code from the callback.
   * @param state - the state from the callback (must match a stored one).
   */
  public static async handleCallback({
    code,
    state,
  }: {
    code: string;
    state: string;
  }): Promise<EstablishedSession> {
    const isStateValid = await OAuthStateStore.consume(state);
    if (!isStateValid) {
      throw new Error("Invalid or expired OAuth state.");
    }

    const tokens = await jiraClient.exchangeCode(code);
    const resources = await jiraClient.listAccessibleResources(tokens.accessToken);
    const [site] = resources;
    if (site === undefined) {
      throw new Error("No accessible Jira site was granted.");
    }
    const identity = await jiraClient.getIdentity(tokens.accessToken);

    const user = await UsersModel.upsert({
      atlassianAccountId: identity.accountId,
      email: identity.email,
    });
    await JiraConnectionsModel.upsert({
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: new Date(Date.now() + tokens.expiresInSeconds * 1000),
      cloudId: site.cloudId,
      refreshToken: tokens.refreshToken,
      siteUrl: site.siteUrl,
      userId: user.id,
    });

    const sessionId = Tokens.generateOpaqueToken(config.constants.sessionIdRandomBytes);
    const expiresAt = new Date(Date.now() + config.constants.sessionTtlSeconds * 1000);
    await SessionsModel.create({ expiresAt, sessionId, userId: user.id });
    return { expiresAt, sessionId };
  }

  /**
   * Validate a session and, if valid, extend its expiry (rolling session).
   * Returns the acting user id, or undefined for a missing/expired session.
   *
   * @param sessionId - the value from the session cookie.
   */
  public static async authenticateSession(sessionId: string): Promise<string | undefined> {
    const now = new Date();
    const userId = await SessionsModel.findValidUserId({ now, sessionId });
    if (userId === undefined) {
      return undefined;
    }
    const expiresAt = new Date(now.getTime() + config.constants.sessionTtlSeconds * 1000);
    await SessionsModel.extend({ expiresAt, sessionId });
    return userId;
  }

  /** End a session (logout). Idempotent. */
  public static async logout(sessionId: string): Promise<void> {
    await SessionsModel.delete(sessionId);
  }
}
