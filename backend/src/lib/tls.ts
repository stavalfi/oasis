/**
 * tls.ts
 *
 * Reads the self-signed TLS certificate used to serve the backend over HTTPS in
 * development. The certificate is generated (no sudo, no OS trust-store install)
 * by backend/scripts/start.sh using the openssl CLI, and written to disk at the
 * paths in `config.server`. The browser shows a one-time "not trusted" warning
 * for `https://localhost` which you click through. This still lets us use
 * `Secure` cookies and an https OAuth callback locally, matching production.
 */
import { readFile } from "node:fs/promises";
import { config } from "./config.ts";

/** A TLS key/cert pair as strings, ready to pass to the server's `tls` option. */
export interface TlsMaterial {
  cert: string;
  key: string;
}

export class Tls {
  /**
   * Read the self-signed key/cert pair from the paths in `config.server`.
   * Assumes start.sh already generated them; throws if the files are missing.
   *
   * @returns the PEM-encoded private key and certificate as strings.
   */
  public static async getLocal(): Promise<TlsMaterial> {
    const [cert, key] = await Promise.all([
      readFile(config.server.tlsCertFile, "utf8"),
      readFile(config.server.tlsKeyFile, "utf8"),
    ]);
    return { cert, key };
  }
}
