/**
 * tokens.ts
 *
 * Generation of opaque random secrets (session ids, API keys, OAuth state) and
 * one-way hashing of API keys. Session ids and state are unguessable random
 * values; API keys are stored only as a SHA-256 hash (like a password), and the
 * raw key is shown to the user exactly once.
 */
import { createHash, randomBytes } from "node:crypto";
import { config } from "./config.ts";

/** A newly minted API key: the raw value (shown once) and the hash we store. */
export interface GeneratedApiKey {
  rawKey: string;
  keyHash: string;
}

export class Tokens {
  /**
   * Generate a URL-safe opaque token with the given entropy.
   *
   * @param byteLength - number of random bytes (base64url-encoded in the result).
   */
  public static generateOpaqueToken(byteLength: number): string {
    return randomBytes(byteLength).toString("base64url");
  }

  /**
   * Hash a presented API key for storage/lookup. No salt (the key is
   * high-entropy).
   */
  public static hashApiKey(rawKey: string): string {
    return createHash("sha256").update(rawKey).digest("hex");
  }

  /** Create a fresh API key: a prefixed random value plus its stored hash. */
  public static generateApiKey(): GeneratedApiKey {
    const rawKey = `${config.constants.apiKeyPrefix}${Tokens.generateOpaqueToken(config.constants.apiKeyRandomBytes)}`;
    return { keyHash: Tokens.hashApiKey(rawKey), rawKey };
  }
}
