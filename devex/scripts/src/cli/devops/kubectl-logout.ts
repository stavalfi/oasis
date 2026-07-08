import { kubeconfigContext } from "#libs/kubeconfig-context.ts";
import { type Command, Option } from "@commander-js/extra-typings";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { type Env, PulumiCliUtils } from "./pulumi-cli-utils.ts";

const execFileAsync = promisify(execFile);

const KubeconfigSchema = z.object({
  users: z
    .array(
      z.object({
        name: z.string(),
        user: z.object({ exec: z.object({ args: z.array(z.string()) }).optional() }).optional(),
      }),
    )
    .optional(),
});

export class KubectlLogoutCommand {
  readonly #signal: AbortSignal;

  public constructor({ signal }: { signal: AbortSignal; repoRoot: string }) {
    this.#signal = signal;
  }

  public register(parent: Command): void {
    parent
      .command("kubectl-logout")
      .description("Remove OIDC password-grant credentials from kubeconfig")
      .addOption(
        new Option("--env <env>", "environment name").choices(["local"]).makeOptionMandatory(),
      )
      .requiredOption("--namespace <namespace>", "namespace")
      .action(async (args) => {
        await this.#run({ env: args.env, namespace: args.namespace });
      });
  }

  async #run(args: { readonly env: Env; readonly namespace: string }): Promise<void> {
    PulumiCliUtils.validateNamespaceSegment({ label: "namespace", value: args.namespace });
    const { namespace } = args;

    const context = kubeconfigContext({ clusterName: namespace, env: args.env });

    const { stdout: raw } = await execFileAsync(
      "kubectl",
      ["config", "view", "--raw", "-o", "json"],
      { signal: this.#signal },
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
        ...["oidc-login", "get-token", ...flagArgs].map((a) => `--exec-arg=${a}`),
      ],
      { signal: this.#signal },
    );

    await execFileAsync("kubectl", ["oidc-login", "clean"], { signal: this.#signal });
  }
}
