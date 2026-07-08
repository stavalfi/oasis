/**
 * tls.ts
 *
 * Provides a locally-trusted TLS certificate for running the backend over HTTPS
 * in development. Uses `devcert`, which creates a local certificate authority
 * and registers it with the OS trust store on first run, so `https://localhost`
 * has no browser warning. This lets us use `Secure` cookies and an https OAuth
 * callback locally, matching production behavior.
 */
import { certificateFor } from "devcert";

/** A TLS key/cert pair as strings, ready to pass to the server's `tls` option. */
export interface TlsMaterial {
  cert: string;
  key: string;
}

export class Tls {
  /**
   * Return a locally-trusted key/cert pair for the given host (default
   * "localhost"). On first run devcert may prompt for sudo to install its root
   * CA into the system trust store.
   *
   * @param host - the hostname the certificate is issued for.
   * @returns the PEM-encoded private key and certificate as strings.
   */
  public static async getLocal(host = "localhost"): Promise<TlsMaterial> {
    const { key, cert } = await certificateFor(host);
    return { cert: cert.toString(), key: key.toString() };
  }
}
