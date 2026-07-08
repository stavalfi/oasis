import { kubeconfigContext } from "#libs/kubeconfig-context.ts";
import { type Command, Option } from "@commander-js/extra-typings";
import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { PortParser } from "../utils/port-parser.ts";
import { IdentitiesReport } from "./get-initial-identities-and-bots/get-initial-identities-and-bots.ts";
import { type Env } from "./pulumi-cli-utils.ts";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const KubeconfigSchema = z.object({
  clusters: z
    .array(
      z.object({
        cluster: z.object({
          "certificate-authority-data": z.string().optional(),
          server: z.string(),
        }),
        name: z.string(),
      }),
    )
    .optional(),
  users: z
    .array(
      z.object({
        name: z.string(),
        user: z.object({ exec: z.object({ args: z.array(z.string()) }).optional() }).optional(),
      }),
    )
    .optional(),
});

const ExecCredentialSchema = z.object({
  status: z.object({ token: z.string() }),
});

export class KubectlLoginCommand {
  readonly #signal: AbortSignal;
  readonly #repoRoot: string;

  public constructor({ signal, repoRoot }: { signal: AbortSignal; repoRoot: string }) {
    this.#signal = signal;
    this.#repoRoot = repoRoot;
  }

  public register(parent: Command): void {
    parent
      .command("kubectl-login")
      .description("Write OIDC password-grant token into kubeconfig")
      .addOption(
        new Option("--env <env>", "environment name").choices(["local"]).makeOptionMandatory(),
      )
      .requiredOption("--cluster-name <name>", "kind cluster name")
      .addOption(
        new Option("--gateway-port <port>", "Rauthy gateway host port")
          .argParser(PortParser.parse)
          .makeOptionMandatory(),
      )
      .addOption(
        new Option("--s3-port <port>", "S3-compatible backend API port")
          .argParser(PortParser.parse)
          .makeOptionMandatory(),
      )
      .requiredOption("--principal <principal>", "username, email, or bot id")
      .option(
        "--print-kubeconfig-to-stdout",
        "write a static-token kubeconfig to stdout instead of updating ~/.kube/config",
      )
      .action(async (args) => {
        if (args.printKubeconfigToStdout) {
          await this.#printKubeconfigToStdout({
            clusterName: args.clusterName,
            env: args.env,
            gatewayPort: args.gatewayPort,
            principal: args.principal,
            s3ApiPort: args.s3Port,
          });
        } else {
          await this.#run({
            clusterName: args.clusterName,
            env: args.env,
            gatewayPort: args.gatewayPort,
            principal: args.principal,
            s3ApiPort: args.s3Port,
          });
        }
      });
  }

  async #run(args: {
    readonly clusterName: string;
    readonly env: Env;
    readonly gatewayPort: number;
    readonly s3ApiPort: number;
    readonly principal: string;
  }): Promise<void> {
    const context = kubeconfigContext({ clusterName: args.clusterName, env: args.env });
    const execEnv =
      args.env === "local"
        ? {
            ...process.env,
            NODE_EXTRA_CA_CERTS: `${process.env["HOME"]}/.local/share/mkcert/rootCA.pem`,
          }
        : process.env;
    const credential = await IdentitiesReport.findCredential({
      env: args.env,
      gatewayPort: args.gatewayPort,
      principal: args.principal,
      repoRoot: this.#repoRoot,
      s3ApiPort: args.s3ApiPort,
      signal: this.#signal,
    });

    const { stdout: raw } = await execFileAsync(
      "kubectl",
      ["config", "view", "--raw", "-o", "json"],
      { env: execEnv, signal: this.#signal },
    );
    const currentArgs =
      KubeconfigSchema.parse(JSON.parse(raw)).users?.find((u) => u.name === context)?.user?.exec
        ?.args ?? [];

    const flagArgs = currentArgs.filter(
      (a) =>
        a !== "oidc-login" &&
        a !== "get-token" &&
        !a.startsWith("--grant-type=") &&
        !a.startsWith("--username="),
    );

    await execAsync(
      `kubectl oidc-login get-token ${[...flagArgs, `--grant-type=password`, `--username=${credential.email}`, `--password=${credential.password}`, "--force-refresh"].map((a) => `'${a}'`).join(" ")}`,
      { env: execEnv, signal: this.#signal },
    );

    await execFileAsync(
      "kubectl",
      [
        "config",
        "set-credentials",
        context,
        "--exec-api-version=client.authentication.k8s.io/v1beta1",
        "--exec-command=kubectl",
        "--exec-interactive-mode=IfAvailable",
        "--exec-provide-cluster-info=true",
        ...[
          "oidc-login",
          "get-token",
          ...flagArgs,
          `--grant-type=password`,
          `--username=${credential.email}`,
        ].map((a) => `--exec-arg=${a}`),
      ],
      { env: execEnv, signal: this.#signal },
    );
  }

  async #printKubeconfigToStdout(args: {
    readonly clusterName: string;
    readonly env: Env;
    readonly gatewayPort: number;
    readonly s3ApiPort: number;
    readonly principal: string;
  }): Promise<void> {
    const kubeconfigCtx = kubeconfigContext({ clusterName: args.clusterName, env: args.env });
    const execEnv =
      args.env === "local"
        ? {
            ...process.env,
            NODE_EXTRA_CA_CERTS: `${process.env["HOME"]}/.local/share/mkcert/rootCA.pem`,
          }
        : process.env;

    const credential = await IdentitiesReport.findCredential({
      env: args.env,
      gatewayPort: args.gatewayPort,
      principal: args.principal,
      repoRoot: this.#repoRoot,
      s3ApiPort: args.s3ApiPort,
      signal: this.#signal,
    });

    const { stdout: raw } = await execFileAsync(
      "kubectl",
      ["config", "view", "--raw", "-o", "json"],
      { env: execEnv, signal: this.#signal },
    );
    const kubeconfig = KubeconfigSchema.parse(JSON.parse(raw));

    const currentArgs =
      kubeconfig.users?.find((u) => u.name === kubeconfigCtx)?.user?.exec?.args ?? [];
    const flagArgs = currentArgs.filter(
      (a) =>
        a !== "oidc-login" &&
        a !== "get-token" &&
        !a.startsWith("--grant-type=") &&
        !a.startsWith("--username="),
    );

    const { stdout: execCredentialJson } = await execAsync(
      `kubectl oidc-login get-token ${[...flagArgs, `--grant-type=password`, `--username=${credential.email}`, `--password=${credential.password}`, "--force-refresh"].map((a) => `'${a}'`).join(" ")}`,
      { env: execEnv, signal: this.#signal },
    );

    const { token } = ExecCredentialSchema.parse(JSON.parse(execCredentialJson)).status;

    const clusterEntry = kubeconfig.clusters?.find((c) => c.name === kubeconfigCtx);
    if (clusterEntry === undefined) {
      throw new Error(
        `No cluster '${kubeconfigCtx}' in kubeconfig. Run \`bun run pulumi:up:local --cluster-name ${args.clusterName}\` first.`,
      );
    }

    console.log(
      [
        "apiVersion: v1",
        "kind: Config",
        "clusters:",
        `  - name: ${kubeconfigCtx}`,
        "    cluster:",
        `      server: ${clusterEntry.cluster.server}`,
        `      certificate-authority-data: ${clusterEntry.cluster["certificate-authority-data"] ?? ""}`,
        "contexts:",
        `  - name: ${kubeconfigCtx}`,
        "    context:",
        `      cluster: ${kubeconfigCtx}`,
        `      user: ${kubeconfigCtx}`,
        `current-context: ${kubeconfigCtx}`,
        "users:",
        `  - name: ${kubeconfigCtx}`,
        "    user:",
        `      token: ${token}`,
        "",
      ].join("\n"),
    );
  }
}
