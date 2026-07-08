/**
 * sessions.ts
 *
 * Model for the `sessions` table: opaque server-side sessions with rolling
 * expiry. Validity is enforced here by comparing `expires_at` to the caller's
 * `now`, never by trusting the cookie. The only code that reads or writes
 * `sessions`.
 */
import { db } from "../db/database.ts";

export class SessionsModel {
  /**
   * Create a session row. The random `sessionId` and `expiresAt` are computed
   * by the caller (the auth service).
   */
  public static async create({
    sessionId,
    userId,
    expiresAt,
  }: {
    sessionId: string;
    userId: string;
    expiresAt: Date;
  }): Promise<void> {
    await db
      .insertInto("sessions")
      .values({ expires_at: expiresAt, session_id: sessionId, user_id: userId })
      .execute();
  }

  /**
   * Resolve the owning user for a session that exists and has not expired as of
   * `now`. Returns undefined for a missing or expired session.
   */
  public static async findValidUserId({
    sessionId,
    now,
  }: {
    sessionId: string;
    now: Date;
  }): Promise<string | undefined> {
    const row = await db
      .selectFrom("sessions")
      .select("user_id")
      .where("session_id", "=", sessionId)
      .where("expires_at", ">", now)
      .executeTakeFirst();
    return row?.user_id;
  }

  /** Extend a session's expiry (rolling session). Scoped to the session id. */
  public static async extend({
    sessionId,
    expiresAt,
  }: {
    sessionId: string;
    expiresAt: Date;
  }): Promise<void> {
    await db
      .updateTable("sessions")
      .set({ expires_at: expiresAt })
      .where("session_id", "=", sessionId)
      .execute();
  }

  /** Delete a session (logout). Idempotent. */
  public static async delete(sessionId: string): Promise<void> {
    await db.deleteFrom("sessions").where("session_id", "=", sessionId).execute();
  }
}
