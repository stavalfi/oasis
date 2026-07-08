import { access, glob, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { Agent, fetch as undiciFetch } from "undici";
import { z } from "zod";

const SPEC_URL = "https://rauthy.localhost:30443/auth/v1/docs/openapi.json";
const SPEC_DIR = "devex/configs";
const CA_CERT = path.join(homedir(), ".local/share/mkcert/rootCA.pem");

const SpecSchema = z.looseObject({
  info: z.looseObject({ version: z.string().optional() }).optional(),
});

export class RauthyFetchSpec {
  readonly #repoRoot: string;
  readonly #signal: AbortSignal;

  public constructor({ repoRoot, signal }: { repoRoot: string; signal: AbortSignal }) {
    this.#repoRoot = repoRoot;
    this.#signal = signal;
  }

  public async run(): Promise<void> {
    const existing = await Array.fromAsync(
      glob("rauthy-openapi-*.json", { cwd: path.join(this.#repoRoot, SPEC_DIR) }),
    );
    if (existing.length > 0) {
      return;
    }

    await access(CA_CERT).catch(() => {
      throw new Error(`mkcert root CA not found at ${CA_CERT} — run \`mkcert -install\` first.`);
    });

    await mkdir(path.join(this.#repoRoot, SPEC_DIR), { recursive: true });

    const ca = await readFile(CA_CERT, "utf8");
    const agent = new Agent({ connect: { ca } });
    const response = await undiciFetch(SPEC_URL, { dispatcher: agent, signal: this.#signal });
    const rawJson = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${rawJson}`);
    }

    const spec = SpecSchema.parse(JSON.parse(rawJson));
    const version = spec.info?.version?.replace(/^v/u, "");

    if (!version || version === "null") {
      throw new Error("spec has no .info.version — refusing to write an unversioned file.");
    }

    const specOut = path.join(this.#repoRoot, SPEC_DIR, `rauthy-openapi-${version}.json`);

    try {
      await access(specOut);
    } catch {
      const tmp = `${specOut}.tmp`;
      await writeFile(tmp, JSON.stringify(spec, undefined, 2));
      await rename(tmp, specOut);
    }
  }
}
