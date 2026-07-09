/**
 * crypto.ts
 *
 * Field-level encryption for credentials at rest (Jira access and refresh
 * tokens). Uses AES-256-GCM with a single symmetric app key from the
 * environment (`ENCRYPTION_KEY`, 32 bytes base64). Each value is encrypted with
 * a fresh random 96-bit IV; the stored string packs iv, auth tag, and
 * ciphertext so a value is self-describing and tamper-evident (GCM auth tag).
 *
 * This is defense-in-depth against a stolen database dump; it is not a tenant
 * isolation mechanism (see the Multi-tenant isolation section of the design).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "../config.ts";

/** AES-256-GCM parameters. The key is 32 bytes; GCM standard IV is 12 bytes. */
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
/** Separator between the base64 iv, tag, and ciphertext segments. */
const SEGMENT_SEPARATOR = ".";

export class FieldCrypto {
  /** The decoded, validated symmetric key, resolved once at class load. */
  static readonly #key = FieldCrypto.#decodeKey();

  /** Decode and validate the symmetric key from configuration. */
  static #decodeKey(): Buffer {
    const decodedKey = Buffer.from(config.encryptionKey, "base64");
    if (decodedKey.length !== KEY_BYTES) {
      throw new Error(
        `ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${decodedKey.length}). Provide a 32-byte base64 key.`,
      );
    }
    return decodedKey;
  }

  /**
   * Encrypt a plaintext string for storage at rest.
   *
   * @param plaintext - the value to encrypt (for example a Jira token).
   * @returns a `iv.tag.ciphertext` string of base64 segments.
   */
  public static encrypt(plaintext: string): string {
    const initializationVector = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, FieldCrypto.#key, initializationVector);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [
      initializationVector.toString("base64"),
      authTag.toString("base64"),
      ciphertext.toString("base64"),
    ].join(SEGMENT_SEPARATOR);
  }

  /**
   * Decrypt a value produced by {@link encrypt}. Throws if the input is
   * malformed or fails the GCM authentication check (tampering or wrong key).
   *
   * @param ciphertext - the packed `iv.tag.ciphertext` string.
   * @returns the original plaintext string.
   */
  public static decrypt(ciphertext: string): string {
    const segments = ciphertext.split(SEGMENT_SEPARATOR);
    if (segments.length !== 3) {
      throw new Error("Encrypted value is malformed: expected three base64 segments.");
    }
    const [initializationVectorPart, authTagPart, dataPart] = segments;
    if (
      initializationVectorPart === undefined ||
      authTagPart === undefined ||
      dataPart === undefined
    ) {
      throw new Error("Encrypted value is malformed: missing a segment.");
    }
    const decipher = createDecipheriv(
      ALGORITHM,
      FieldCrypto.#key,
      Buffer.from(initializationVectorPart, "base64"),
    );
    decipher.setAuthTag(Buffer.from(authTagPart, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataPart, "base64")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  }
}
