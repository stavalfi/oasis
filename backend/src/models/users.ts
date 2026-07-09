/**
 * users.ts
 *
 * Model for the `users` table. A user is a tenant, identified by their
 * Atlassian account id. This is part of the models choke point: the only code
 * that reads or writes `users` in Postgres.
 */
import { db } from "../db/database.ts";
import type { UserRow } from "./types.ts";

export class UsersModel {
  /**
   * Insert the user if new, or update their email if they already exist, keyed
   * by Atlassian account id. Returns the full row (including the stable `id`).
   *
   * @param atlassianAccountId - the Atlassian account id from the identity call.
   * @param email - the user's email from the identity call.
   */
  public static upsert({
    atlassianAccountId,
    email,
  }: {
    atlassianAccountId: string;
    email: string;
  }): Promise<UserRow> {
    return db
      .insertInto("users")
      .values({ atlassian_account_id: atlassianAccountId, email })
      .onConflict((onConflict) => onConflict.column("atlassian_account_id").doUpdateSet({ email }))
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Look up a user by id. Returns undefined if no such user exists.
   *
   * @param userId - the acting user's id.
   */
  public static findById(userId: string): Promise<UserRow | undefined> {
    return db.selectFrom("users").selectAll().where("id", "=", userId).executeTakeFirst();
  }
}
