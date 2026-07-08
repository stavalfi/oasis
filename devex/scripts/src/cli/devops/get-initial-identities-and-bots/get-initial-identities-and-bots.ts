import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Agent, fetch as undiciFetch } from "undici";
import { z } from "zod";
import { type Env, PulumiCliUtils } from "../pulumi-cli-utils.ts";

const execFileAsync = promisify(execFile);

interface Args {
  readonly env: Env;
  readonly gatewayPort: number;
  readonly json: boolean;
  readonly namespace: string;
  readonly repoRoot: string;
  readonly s3ApiPort: number;
  readonly signal: AbortSignal;
}

export interface UserRow {
  readonly email: string;
  readonly name: string;
  readonly password: string;
}
export interface BotRow {
  readonly name: string;
  readonly email: string;
  readonly password: string;
}

const RAUTHY_CA_CERT = path.join(homedir(), ".local/share/mkcert/rootCA.pem");
const RAUTHY_READER_API_KEY_NAME = "rauthy-reader";

const RAUTHY_USER_PW_URN_PATTERN = /::rauthy-pw-(?<name>[A-Za-z0-9_-]+)$/u;
const RAUTHY_BOT_PW_URN_PATTERN = /::rauthy-bot-pw-(?<name>[A-Za-z0-9_-]+)$/u;
const SECRET_WRAPPER_SENTINEL_KEY = "4dabf18193072939515e22adb298388d";
const MAX_STATE_BYTES = 64 * 1024 * 1024;

const SecretWrapperSchema = z.object({
  [SECRET_WRAPPER_SENTINEL_KEY]: z.string(),
  plaintext: z.string(),
});
const ResultSchema = z.union([z.string(), SecretWrapperSchema]);
const StateSchema = z.object({
  deployment: z.object({
    resources: z.array(
      z.object({
        outputs: z.looseObject({ result: ResultSchema.optional() }).optional(),
        type: z.string(),
        urn: z.string(),
      }),
    ),
  }),
});
type State = z.infer<typeof StateSchema>;
type StateResource = State["deployment"]["resources"][number];

export class IdentitiesReport {
  readonly #args: Args;
  readonly #signal: AbortSignal;

  public constructor(args: Args) {
    this.#args = args;
    this.#signal = args.signal;
  }

  public async run(): Promise<void> {
    const { userPasswords, botPasswords, readerApiKey } =
      await IdentitiesReport.#loadCredentialsFromStack({
        env: this.#args.env,
        repoRoot: this.#args.repoRoot,
        s3ApiPort: this.#args.s3ApiPort,
        signal: this.#signal,
      });

    if (readerApiKey === undefined) {
      throw new Error(
        `No rauthy-reader API key in Pulumi state for env '${this.#args.env}'. Run \`bun run pulumi:up:${this.#args.env}\` first.`,
      );
    }
    const emailMap = await IdentitiesReport.#fetchUserEmailMap({
      env: this.#args.env,
      gatewayPort: this.#args.gatewayPort,
      readerApiKey,
      signal: this.#signal,
    });

    const userRows: readonly UserRow[] = [...userPasswords.entries()].map(([name, password]) => ({
      email: emailMap.get(name) ?? name,
      name,
      password,
    }));
    const botRows: readonly BotRow[] = [...botPasswords.entries()].map(([name, password]) => ({
      email: IdentitiesReport.#botEmail(name),
      name,
      password,
    }));

    if (this.#args.json) {
      console.log(`${JSON.stringify({ bots: botRows, identities: userRows }, undefined, 2)}\n`);
      return;
    }
    console.log("identities (humans)");
    console.table(userRows);
    console.log("\nbots (machines)");
    console.table(botRows);
  }

  public static async findUserPassword(args: {
    readonly env: Env;
    readonly gatewayPort: number;
    readonly s3ApiPort: number;
    readonly identifier: string;
    readonly repoRoot: string;
    readonly signal: AbortSignal;
  }): Promise<UserRow> {
    const { userPasswords, readerApiKey } = await IdentitiesReport.#loadCredentialsFromStack({
      env: args.env,
      repoRoot: args.repoRoot,
      s3ApiPort: args.s3ApiPort,
      signal: args.signal,
    });
    const name = args.identifier.includes("@")
      ? (args.identifier.split("@")[0] ?? args.identifier)
      : args.identifier;
    const password = userPasswords.get(name);
    if (password === undefined) {
      const known = [...userPasswords.keys()].join(", ");
      throw new Error(
        `No user matches '${args.identifier}' in Pulumi state for env '${args.env}'. ` +
          `Known users: ${known || "none"} — run \`bun run pulumi:up:${args.env}\` first.`,
      );
    }
    if (args.identifier.includes("@")) {
      return { email: args.identifier, name, password };
    }
    if (readerApiKey === undefined) {
      throw new Error(
        `No rauthy-reader API key in Pulumi state for env '${args.env}'. Run \`bun run pulumi:up:${args.env}\` first.`,
      );
    }
    const emailMap = await IdentitiesReport.#fetchUserEmailMap({
      env: args.env,
      gatewayPort: args.gatewayPort,
      readerApiKey,
      signal: args.signal,
    });
    return { email: emailMap.get(name) ?? name, name, password };
  }

  /*
   * Resolve a password for either a human (by name or email) or a bot (by
   * id). Both kinds are Rauthy users now, so the caller gets back the
   * email Rauthy expects in the `username` field of the password grant +
   * the password itself. Used by kubectl-login so it doesn't have to
   * care whether `--principal` refers to a human or a bot.
   */
  public static async findCredential(args: {
    readonly env: Env;
    readonly gatewayPort: number;
    readonly s3ApiPort: number;
    readonly principal: string;
    readonly repoRoot: string;
    readonly signal: AbortSignal;
  }): Promise<{
    readonly email: string;
    readonly password: string;
    readonly kind: "human" | "machine";
  }> {
    const { userPasswords, botPasswords, readerApiKey } =
      await IdentitiesReport.#loadCredentialsFromStack({
        env: args.env,
        repoRoot: args.repoRoot,
        s3ApiPort: args.s3ApiPort,
        signal: args.signal,
      });

    const name = args.principal.includes("@")
      ? (args.principal.split("@")[0] ?? args.principal)
      : args.principal;

    const userPassword = userPasswords.get(name);
    if (userPassword !== undefined) {
      if (args.principal.includes("@")) {
        return { email: args.principal, kind: "human", password: userPassword };
      }
      if (readerApiKey === undefined) {
        throw new Error(
          `No rauthy-reader API key in Pulumi state for env '${args.env}'. Run \`bun run pulumi:up:${args.env}\` first.`,
        );
      }
      const emailMap = await IdentitiesReport.#fetchUserEmailMap({
        env: args.env,
        gatewayPort: args.gatewayPort,
        readerApiKey,
        signal: args.signal,
      });
      return { email: emailMap.get(name) ?? name, kind: "human", password: userPassword };
    }

    const botPassword = botPasswords.get(args.principal);
    if (botPassword !== undefined) {
      return {
        email: IdentitiesReport.#botEmail(args.principal),
        kind: "machine",
        password: botPassword,
      };
    }

    const knownUsers = [...userPasswords.keys()].join(", ");
    const knownBots = [...botPasswords.keys()].join(", ");
    throw new Error(
      `No principal matches '${args.principal}' in Pulumi state for env '${args.env}'. ` +
        `Known users: ${knownUsers || "none"}. Known bots: ${knownBots || "none"}.`,
    );
  }

  public static async findBotPassword(args: {
    readonly env: Env;
    readonly s3ApiPort: number;
    readonly name: string;
    readonly repoRoot: string;
    readonly signal: AbortSignal;
  }): Promise<BotRow> {
    const { botPasswords } = await IdentitiesReport.#loadCredentialsFromStack({
      env: args.env,
      repoRoot: args.repoRoot,
      s3ApiPort: args.s3ApiPort,
      signal: args.signal,
    });
    const password = botPasswords.get(args.name);
    if (password === undefined) {
      const known = [...botPasswords.keys()].join(", ");
      throw new Error(
        `No bot matches name '${args.name}' in Pulumi state for env '${args.env}'. ` +
          `Known bots: ${known || "none"} — run \`bun run pulumi:up:${args.env}\` first.`,
      );
    }
    return { email: IdentitiesReport.#botEmail(args.name), name: args.name, password };
  }

  static #rauthyBaseUrl({ env, gatewayPort }: { env: Env; gatewayPort: number }): string {
    if (env === "local") {
      return `https://rauthy.localhost:${gatewayPort}/auth/v1`;
    }
    throw new Error(`Unknown env '${env}'`);
  }

  static #botEmail(id: string): string {
    return `${id}@bot.local`;
  }

  static async #fetchUserEmailMap(args: {
    readonly env: Env;
    readonly gatewayPort: number;
    readonly readerApiKey: string;
    readonly signal: AbortSignal;
  }): Promise<Map<string, string>> {
    const ca = await readFile(RAUTHY_CA_CERT, "utf8");
    const agent = new Agent({ connect: { ca } });
    // eslint-disable-next-line poc-rules/require-object-params
    const secureFetch = (
      url: string,
      init?: Parameters<typeof undiciFetch>[1],
    ): Promise<Response> => undiciFetch(url, { ...init, dispatcher: agent });

    const baseUrl = IdentitiesReport.#rauthyBaseUrl({
      env: args.env,
      gatewayPort: args.gatewayPort,
    });

    const usersRes = await secureFetch(`${baseUrl}/users`, {
      headers: { Authorization: `API-Key ${RAUTHY_READER_API_KEY_NAME}$${args.readerApiKey}` },
      signal: args.signal,
    });
    if (!usersRes.ok) {
      throw new Error(`Rauthy GET /users failed: ${usersRes.status} ${await usersRes.text()}`);
    }
    const users = z.array(z.object({ email: z.string() })).parse(await usersRes.json());

    const map = new Map<string, string>();
    for (const user of users) {
      const [name] = user.email.split("@");
      if (name) {
        map.set(name, user.email);
      }
    }
    return map;
  }

  static #unwrapRandomPasswordResult(result: z.infer<typeof ResultSchema>): string {
    if (typeof result === "string") {
      return result;
    }
    return z.string().parse(JSON.parse(result.plaintext));
  }

  static #extractPasswordByPattern({
    resource,
    pattern,
    captureGroup,
  }: {
    resource: StateResource;
    pattern: RegExp;
    captureGroup: string;
  }): { readonly key: string; readonly password: string } | undefined {
    if (resource.type !== "random:index/randomPassword:RandomPassword") {
      return undefined;
    }
    const match = pattern.exec(resource.urn);
    const key = match?.groups?.[captureGroup];
    if (key === undefined) {
      return undefined;
    }
    const result = resource.outputs?.result;
    if (result === undefined) {
      return undefined;
    }
    return { key, password: IdentitiesReport.#unwrapRandomPasswordResult(result) };
  }

  static async #loadStackState(args: {
    readonly env: Env;
    readonly s3ApiPort: number;
    readonly repoRoot: string;
    readonly signal: AbortSignal;
  }): Promise<State> {
    const passphrase = await PulumiCliUtils.decryptPassphrase({
      cwd: args.repoRoot,
      secretRelPath: `devops/infra/secrets/pulumi-passphrase/${args.env}.yaml`,
      signal: args.signal,
    });
    const stack = args.env;
    const { stdout: stateJson } = await execFileAsync(
      "pulumi",
      ["stack", "export", "--stack", stack, "--show-secrets"],
      {
        cwd: path.join(args.repoRoot, "devops", "infra"),
        env: {
          ...process.env,
          PULUMI_BACKEND_URL: PulumiCliUtils.pulumiBackendUrl({
            env: args.env,
            s3ApiPort: args.s3ApiPort,
          }),
          PULUMI_CONFIG_PASSPHRASE: passphrase,
        },
        maxBuffer: MAX_STATE_BYTES,
        signal: args.signal,
      },
    );
    return StateSchema.parse(JSON.parse(stateJson));
  }

  static async #loadCredentialsFromStack(args: {
    readonly env: Env;
    readonly s3ApiPort: number;
    readonly repoRoot: string;
    readonly signal: AbortSignal;
  }): Promise<{
    readonly userPasswords: Map<string, string>;
    readonly botPasswords: Map<string, string>;
    readonly readerApiKey: string | undefined;
  }> {
    const state = await IdentitiesReport.#loadStackState({
      env: args.env,
      repoRoot: args.repoRoot,
      s3ApiPort: args.s3ApiPort,
      signal: args.signal,
    });
    const userPasswords = new Map<string, string>();
    const botPasswords = new Map<string, string>();
    let readerApiKey: string | undefined;
    for (const resource of state.deployment.resources) {
      if (
        resource.type === "random:index/randomPassword:RandomPassword" &&
        resource.urn.endsWith("::rauthy-reader-api-key-secret")
      ) {
        const result = resource.outputs?.result;
        if (result !== undefined) {
          readerApiKey = IdentitiesReport.#unwrapRandomPasswordResult(result);
        }
      } else {
        const userEntry = IdentitiesReport.#extractPasswordByPattern({
          captureGroup: "name",
          pattern: RAUTHY_USER_PW_URN_PATTERN,
          resource,
        });
        if (userEntry === undefined) {
          const botEntry = IdentitiesReport.#extractPasswordByPattern({
            captureGroup: "name",
            pattern: RAUTHY_BOT_PW_URN_PATTERN,
            resource,
          });
          if (botEntry !== undefined) {
            botPasswords.set(botEntry.key, botEntry.password);
          }
        } else {
          userPasswords.set(userEntry.key, userEntry.password);
        }
      }
    }
    return { botPasswords, readerApiKey, userPasswords };
  }
}
