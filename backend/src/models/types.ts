/**
 * types.ts
 *
 * Domain types for the models layer: row aliases derived from the generated
 * Kysely schema, plus the curated shapes model functions return.
 */
import type { Selectable } from "kysely";
import type { Tickets, Users } from "../db/schema.ts";

export type UserRow = Selectable<Users>;
export type TicketRow = Selectable<Tickets>;

/** A tenant's Jira connection with decrypted tokens, as used by services. */
export interface JiraConnection {
  cloudId: string;
  siteUrl: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
}

/** API key metadata returned to the UI (never the raw key or its hash). */
export interface ApiKeyMetadata {
  id: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date;
}

/** The fields needed to authenticate a presented key. */
export interface ApiKeyAuthRow {
  id: string;
  userId: string;
  expiresAt: Date;
}
