/**
 * me.ts
 *
 * Builds the current-user view (identity plus connected Jira site), cached per
 * user. No tokens are ever included in the result.
 */
import type { MeResponse } from "../dto/types.ts";
import { meResponseSchema } from "../dto/schemas.ts";
import { config } from "../config.ts";
import { JiraConnectionsModel } from "../models/jira-connections.ts";
import { UsersModel } from "../models/users.ts";
import { Cache } from "../redis/cache.ts";

export class MeService {
  /** Derive a readable site name from the site URL (its host). */
  static #siteNameFromUrl(siteUrl: string): string {
    try {
      return new URL(siteUrl).host;
    } catch {
      return siteUrl;
    }
  }

  /**
   * Return the acting user's profile and connected Jira site, from cache when
   * fresh.
   *
   * @param userId - the acting user.
   */
  public static getMe(userId: string): Promise<MeResponse> {
    return Cache.getOrLoad({
      key: Cache.keyForMe(userId),
      load: async () => {
        const user = await UsersModel.findById(userId);
        if (user === undefined) {
          throw new Error(`User ${userId} not found.`);
        }
        const connection = await JiraConnectionsModel.findByUserId(userId);
        const siteUrl = connection?.siteUrl ?? "";
        return {
          accountId: user.atlassian_account_id,
          email: user.email,
          siteName: siteUrl === "" ? "" : MeService.#siteNameFromUrl(siteUrl),
          siteUrl,
        };
      },
      schema: meResponseSchema,
      ttlSeconds: config.constants.cache.meAndProjectsTtlSeconds,
    });
  }
}
