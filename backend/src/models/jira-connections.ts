/**
 * jira-connections.ts
 *
 * Model for the `jira_connections` table: one connected Jira site per user (the
 * tenant record) plus its OAuth tokens. Field-level encryption is applied here,
 * at the choke point, so tokens are always encrypted at rest and callers only
 * ever see plaintext. The only code that reads or writes `jira_connections`.
 */
import { db } from "../db/database.ts";
import { FieldCrypto } from "../lib/crypto.ts";
import { type JiraConnection } from "./types.ts";

export class JiraConnectionsModel {
  /**
   * Create or replace the user's Jira connection (one per user). Tokens are
   * encrypted before they touch Postgres.
   */
  public static async upsert({
    userId,
    cloudId,
    siteUrl,
    accessToken,
    refreshToken,
    accessTokenExpiresAt,
  }: {
    userId: string;
    cloudId: string;
    siteUrl: string;
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: Date;
  }): Promise<void> {
    const encryptedAccessToken = FieldCrypto.encrypt(accessToken);
    const encryptedRefreshToken = FieldCrypto.encrypt(refreshToken);
    await db
      .insertInto("jira_connections")
      .values({
        access_token_expires_at: accessTokenExpiresAt,
        cloud_id: cloudId,
        enc_access_token: encryptedAccessToken,
        enc_refresh_token: encryptedRefreshToken,
        site_url: siteUrl,
        user_id: userId,
      })
      .onConflict((onConflict) =>
        onConflict.column("user_id").doUpdateSet({
          access_token_expires_at: accessTokenExpiresAt,
          cloud_id: cloudId,
          enc_access_token: encryptedAccessToken,
          enc_refresh_token: encryptedRefreshToken,
          site_url: siteUrl,
        }),
      )
      .execute();
  }

  /**
   * Read the user's Jira connection, decrypting the tokens. Returns undefined if
   * the user has no connection.
   */
  public static async findByUserId(userId: string): Promise<JiraConnection | undefined> {
    const row = await db
      .selectFrom("jira_connections")
      .selectAll()
      .where("user_id", "=", userId)
      .executeTakeFirst();
    if (row === undefined) {
      return undefined;
    }
    return {
      accessToken: FieldCrypto.decrypt(row.enc_access_token),
      accessTokenExpiresAt: row.access_token_expires_at,
      cloudId: row.cloud_id,
      refreshToken: FieldCrypto.decrypt(row.enc_refresh_token),
      siteUrl: row.site_url,
    };
  }

  /**
   * Overwrite the stored tokens after a refresh (the refresh token rotates on
   * each refresh). Scoped to the acting user.
   */
  public static async updateTokens({
    userId,
    accessToken,
    refreshToken,
    accessTokenExpiresAt,
  }: {
    userId: string;
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: Date;
  }): Promise<void> {
    await db
      .updateTable("jira_connections")
      .set({
        access_token_expires_at: accessTokenExpiresAt,
        enc_access_token: FieldCrypto.encrypt(accessToken),
        enc_refresh_token: FieldCrypto.encrypt(refreshToken),
      })
      .where("user_id", "=", userId)
      .execute();
  }
}
