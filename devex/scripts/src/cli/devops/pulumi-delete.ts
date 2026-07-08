import { type Command, Option } from "@commander-js/extra-typings";
import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import net from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { PortParser } from "../utils/port-parser.ts";
import { PulumiCliUtils } from "./pulumi-cli-utils.ts";

const execFileAsync = promisify(execFile);

export class PulumiDeleteCommand {
  readonly #signal: AbortSignal;
  readonly #repoRoot: string;

  public constructor({ signal, repoRoot }: { signal: AbortSignal; repoRoot: string }) {
    this.#signal = signal;
    this.#repoRoot = repoRoot;
  }

  public register(parent: Command): void {
    const cmd = parent
      .command("pulumi-delete")
      .description("Destroy Pulumi stack(s) and strip kubeconfig entries from ~/.kube/config");

    cmd
      .command("local")
      .description("Destroy local (kind) stacks")
      .option("--namespace <namespace>", "destroy only the given matrix+infra stacks")
      .option("--all-namespaces", "destroy ALL stacks (matrix + infra) + tofu")
      .addOption(
        new Option("--s3-port <port>", "host port for the S3-compatible backend")
          .argParser(PortParser.parse)
          .makeOptionMandatory(),
      )
      .action(async (args) => {
        const hasNamespace = args.namespace !== undefined;
        const hasAll = args.allNamespaces === true;
        if (!hasNamespace && !hasAll) {
          throw new Error("One of --namespace or --all-namespaces is required.");
        }
        if (hasNamespace && hasAll) {
          throw new Error("--namespace and --all-namespaces are mutually exclusive.");
        }
        if (hasNamespace) {
          const ns = args.namespace ?? "";
          PulumiCliUtils.validateNamespaceSegment({ label: "namespace", value: ns });
          await this.#runNamespaceLocal({ namespace: ns, s3ApiPort: args.s3Port });
        } else {
          await this.#runAllLocal({ s3ApiPort: args.s3Port });
        }
      });

    cmd
      .command("aws")
      .description("Destroy AWS (EKS) stacks")
      .option("--namespace <namespace>", "destroy only the given matrix+infra stacks")
      .option("--all-namespaces", "destroy ALL stacks (matrix + infra) + tofu")
      .requiredOption("--aws-region <region>", "AWS region")
      .action(async (args) => {
        const hasNamespace = args.namespace !== undefined;
        const hasAll = args.allNamespaces === true;
        if (!hasNamespace && !hasAll) {
          throw new Error("One of --namespace or --all-namespaces is required.");
        }
        if (hasNamespace && hasAll) {
          throw new Error("--namespace and --all-namespaces are mutually exclusive.");
        }
        if (hasNamespace) {
          const ns = args.namespace ?? "";
          PulumiCliUtils.validateNamespaceSegment({ label: "namespace", value: ns });
          await this.#runNamespaceAws({ awsRegion: args.awsRegion, namespace: ns });
        } else {
          await this.#runAllAws({ awsRegion: args.awsRegion });
        }
      });
  }

  async #runNamespaceLocal({
    namespace,
    s3ApiPort,
  }: {
    namespace: string;
    s3ApiPort: number;
  }): Promise<void> {
    const env = "local" as const;
    const matrixStack = `${env}--${namespace}`;
    const infraStack = env;
    const matrixDir = path.join(this.#repoRoot, "devops", "matrix");
    const infraDir = path.join(this.#repoRoot, "devops", "infra");
    const tfDir = path.join(this.#repoRoot, "devops", "s3-terraform", "local");
    const stateFile = path.join(
      homedir(),
      ".local",
      "share",
      "poc",
      "tofu",
      `${namespace}.tfstate`,
    );
    const backendUrl = PulumiCliUtils.pulumiBackendUrl({ env, s3ApiPort });

    const [matrixPassphrase, infraPassphrase] = await Promise.all([
      PulumiCliUtils.decryptPassphrase({
        cwd: this.#repoRoot,
        secretRelPath: `devops/matrix/secrets/pulumi-passphrase/${env}.yaml`,
        signal: this.#signal,
      }),
      PulumiCliUtils.decryptPassphrase({
        cwd: this.#repoRoot,
        secretRelPath: `devops/infra/secrets/pulumi-passphrase/${env}.yaml`,
        signal: this.#signal,
      }),
    ]);
    const matrixEnv = {
      ...process.env,
      PULUMI_BACKEND_URL: backendUrl,
      PULUMI_CONFIG_PASSPHRASE: matrixPassphrase,
    };
    const infraEnv = {
      ...process.env,
      PULUMI_BACKEND_URL: backendUrl,
      PULUMI_CONFIG_PASSPHRASE: infraPassphrase,
    };

    await this.#destroyStack({ dir: matrixDir, pulumiEnv: matrixEnv, stack: matrixStack });
    await this.#destroyStack({ dir: infraDir, pulumiEnv: infraEnv, stack: infraStack });

    await PulumiCliUtils.runInherited({
      args: [
        "destroy",
        "-auto-approve",
        `-state=${stateFile}`,
        `-var=namespace=${namespace}`,
        `-var=s3_api_port=${s3ApiPort}`,
      ],
      cmd: "tofu",
      cwd: tfDir,
      signal: this.#signal,
    }).catch(() => {});

    await PulumiDeleteCommand.#cleanKubeconfig({
      contextName: `${env}--${namespace}`,
      signal: this.#signal,
    });
    console.log(
      `destroyed stacks ${env}--${namespace} and ${env}, removed ${env}--${namespace} from ~/.kube/config`,
    );
  }

  async #runNamespaceAws({
    namespace,
    awsRegion,
  }: {
    namespace: string;
    awsRegion: string;
  }): Promise<void> {
    const env = "prod" as const;
    const matrixStack = `${env}--${namespace}`;
    const infraStack = env;
    const matrixDir = path.join(this.#repoRoot, "devops", "matrix");
    const infraDir = path.join(this.#repoRoot, "devops", "infra");
    const backendUrl = PulumiCliUtils.pulumiBackendUrl({ env });
    const awsEnv = { AWS_DEFAULT_REGION: awsRegion };

    const [matrixPassphrase, infraPassphrase] = await Promise.all([
      PulumiCliUtils.decryptPassphrase({
        cwd: this.#repoRoot,
        secretRelPath: `devops/matrix/secrets/pulumi-passphrase/${env}.yaml`,
        signal: this.#signal,
      }),
      PulumiCliUtils.decryptPassphrase({
        cwd: this.#repoRoot,
        secretRelPath: `devops/infra/secrets/pulumi-passphrase/${env}.yaml`,
        signal: this.#signal,
      }),
    ]);
    const matrixEnv = {
      ...process.env,
      ...awsEnv,
      PULUMI_BACKEND_URL: backendUrl,
      PULUMI_CONFIG_PASSPHRASE: matrixPassphrase,
    };
    const infraEnv = {
      ...process.env,
      ...awsEnv,
      PULUMI_BACKEND_URL: backendUrl,
      PULUMI_CONFIG_PASSPHRASE: infraPassphrase,
    };

    await this.#destroyStack({ dir: matrixDir, pulumiEnv: matrixEnv, stack: matrixStack });
    await this.#destroyStack({ dir: infraDir, pulumiEnv: infraEnv, stack: infraStack });

    await PulumiDeleteCommand.#cleanKubeconfig({
      contextName: `${env}--${namespace}`,
      signal: this.#signal,
    });
    console.log(
      `destroyed stacks ${env}--${namespace} and ${env}, removed ${env}--${namespace} from ~/.kube/config`,
    );
  }

  async #runAllLocal({ s3ApiPort }: { s3ApiPort: number }): Promise<void> {
    const env = "local" as const;
    const infraDir = path.join(this.#repoRoot, "devops", "infra");
    const matrixDir = path.join(this.#repoRoot, "devops", "matrix");
    const tfDir = path.join(this.#repoRoot, "devops", "s3-terraform", "local");
    const statesDir = path.join(homedir(), ".local", "share", "poc", "tofu");

    const [infraPassphrase, matrixPassphrase] = await Promise.all([
      PulumiCliUtils.decryptPassphrase({
        cwd: this.#repoRoot,
        secretRelPath: `devops/infra/secrets/pulumi-passphrase/${env}.yaml`,
        signal: this.#signal,
      }),
      PulumiCliUtils.decryptPassphrase({
        cwd: this.#repoRoot,
        secretRelPath: `devops/matrix/secrets/pulumi-passphrase/${env}.yaml`,
        signal: this.#signal,
      }),
    ]);

    const stateFiles = await readdir(statesDir).catch((): string[] => []);
    const namespaces = stateFiles
      .filter((f) => f.endsWith(".tfstate") && f !== "prod-s3.tfstate")
      .map((f) => f.slice(0, -".tfstate".length));

    await PulumiCliUtils.runInherited({
      args: ["init", "-upgrade=false"],
      cmd: "tofu",
      cwd: tfDir,
      signal: this.#signal,
    }).catch(() => {});

    for (const ns of namespaces) {
      const nsStateFile = path.join(statesDir, `${ns}.tfstate`);
      const nsS3Port = await PulumiDeleteCommand.#readS3PortFromState(nsStateFile).catch(
        () => s3ApiPort,
      );
      if (await PulumiDeleteCommand.#isPortReachable(nsS3Port)) {
        const backendUrl = PulumiCliUtils.pulumiBackendUrl({ env, s3ApiPort: nsS3Port });
        const matrixEnv = {
          ...process.env,
          PULUMI_BACKEND_URL: backendUrl,
          PULUMI_CONFIG_PASSPHRASE: matrixPassphrase,
        };
        const infraEnv = {
          ...process.env,
          PULUMI_BACKEND_URL: backendUrl,
          PULUMI_CONFIG_PASSPHRASE: infraPassphrase,
        };
        await this.#destroyStack({ dir: matrixDir, pulumiEnv: matrixEnv, stack: `${env}--${ns}` });
        await this.#destroyStack({ dir: infraDir, pulumiEnv: infraEnv, stack: env });
      }

      await PulumiCliUtils.runInherited({
        args: [
          "destroy",
          "-auto-approve",
          `-state=${nsStateFile}`,
          `-var=namespace=${ns}`,
          `-var=s3_api_port=${nsS3Port}`,
        ],
        cmd: "tofu",
        cwd: tfDir,
        signal: this.#signal,
      }).catch(() => {});
    }

    await PulumiDeleteCommand.#cleanAllKubeconfigsWithPrefix({
      prefix: `${env}--`,
      signal: this.#signal,
    });
  }

  async #runAllAws({ awsRegion }: { awsRegion: string }): Promise<void> {
    const env = "prod" as const;
    const infraDir = path.join(this.#repoRoot, "devops", "infra");
    const matrixDir = path.join(this.#repoRoot, "devops", "matrix");
    const statesDir = path.join(homedir(), ".local", "share", "poc", "tofu");
    const backendUrl = PulumiCliUtils.pulumiBackendUrl({ env });
    const awsEnv = { AWS_DEFAULT_REGION: awsRegion };

    const [infraPassphrase, matrixPassphrase] = await Promise.all([
      PulumiCliUtils.decryptPassphrase({
        cwd: this.#repoRoot,
        secretRelPath: `devops/infra/secrets/pulumi-passphrase/${env}.yaml`,
        signal: this.#signal,
      }),
      PulumiCliUtils.decryptPassphrase({
        cwd: this.#repoRoot,
        secretRelPath: `devops/matrix/secrets/pulumi-passphrase/${env}.yaml`,
        signal: this.#signal,
      }),
    ]);
    const matrixEnv = {
      ...process.env,
      ...awsEnv,
      PULUMI_BACKEND_URL: backendUrl,
      PULUMI_CONFIG_PASSPHRASE: matrixPassphrase,
    };
    const infraEnv = {
      ...process.env,
      ...awsEnv,
      PULUMI_BACKEND_URL: backendUrl,
      PULUMI_CONFIG_PASSPHRASE: infraPassphrase,
    };

    const { stdout: stacksRaw } = await execFileAsync("pulumi", ["stack", "ls", "--json"], {
      cwd: matrixDir,
      env: matrixEnv,
    }).catch(() => ({ stdout: "[]" }));
    const stacks: { name: string }[] = JSON.parse(stacksRaw);
    for (const { name: stackName } of stacks.filter((s) => s.name.startsWith(`${env}--`))) {
      await this.#destroyStack({ dir: matrixDir, pulumiEnv: matrixEnv, stack: stackName });
    }

    await this.#destroyStack({ dir: infraDir, pulumiEnv: infraEnv, stack: env });

    const tfAwsDir = path.join(this.#repoRoot, "devops", "s3-terraform", "prod");
    const prodS3StateFile = path.join(statesDir, "prod-s3.tfstate");
    await PulumiCliUtils.runInherited({
      args: ["init", "-upgrade=false"],
      cmd: "tofu",
      cwd: tfAwsDir,
      signal: this.#signal,
    }).catch(() => {});
    await PulumiCliUtils.runInherited({
      args: ["destroy", "-auto-approve", `-state=${prodS3StateFile}`],
      cmd: "tofu",
      cwd: tfAwsDir,
      signal: this.#signal,
    }).catch(() => {});

    await PulumiDeleteCommand.#cleanAllKubeconfigsWithPrefix({
      prefix: `${env}--`,
      signal: this.#signal,
    });
  }

  async #destroyStack(args: {
    readonly dir: string;
    readonly stack: string;
    readonly pulumiEnv: NodeJS.ProcessEnv;
  }): Promise<void> {
    const { dir, stack, pulumiEnv } = args;
    await PulumiCliUtils.runInherited({
      args: ["destroy", "--stack", stack, "--yes"],
      cmd: "pulumi",
      cwd: dir,
      env: { ...pulumiEnv, PULUMI_K8S_DELETE_UNREACHABLE: "true" },
      signal: this.#signal,
    }).catch(() => {});
    await PulumiCliUtils.runInherited({
      args: ["stack", "rm", "--stack", stack, "--yes"],
      cmd: "pulumi",
      cwd: dir,
      env: pulumiEnv,
      signal: this.#signal,
    }).catch(() => {});
  }

  static async #cleanKubeconfig({
    contextName,
    signal,
  }: {
    contextName: string;
    signal: AbortSignal;
  }): Promise<void> {
    await execFileAsync("kubectl", ["config", "delete-context", contextName], {
      signal,
    }).catch(() => {});
    await execFileAsync("kubectl", ["config", "delete-cluster", contextName], {
      signal,
    }).catch(() => {});
    await execFileAsync("kubectl", ["config", "delete-user", contextName], {
      signal,
    }).catch(() => {});

    const { stdout: currentCtx } = await execFileAsync(
      "kubectl",
      ["config", "view", "--raw", "-o", "jsonpath={.current-context}"],
      { signal },
    ).catch(() => ({ stdout: "" }));
    if (currentCtx.trim() === contextName) {
      await execFileAsync("kubectl", ["config", "unset", "current-context"], { signal }).catch(
        () => {},
      );
    }
  }

  static async #cleanAllKubeconfigsWithPrefix({
    prefix,
    signal,
  }: {
    prefix: string;
    signal: AbortSignal;
  }): Promise<void> {
    const { stdout: contextsRaw } = await execFileAsync(
      "kubectl",
      ["config", "view", "-o", "jsonpath={.contexts[*].name}"],
      { signal },
    ).catch(() => ({ stdout: "" }));
    const allContexts = contextsRaw.trim().split(" ").filter(Boolean);
    const envContexts = allContexts.filter((c) => c.startsWith(prefix));

    const { stdout: currentCtx } = await execFileAsync(
      "kubectl",
      ["config", "view", "--raw", "-o", "jsonpath={.current-context}"],
      { signal },
    ).catch(() => ({ stdout: "" }));

    for (const ctx of envContexts) {
      await execFileAsync("kubectl", ["config", "delete-context", ctx], { signal }).catch(() => {});
      await execFileAsync("kubectl", ["config", "delete-cluster", ctx], { signal }).catch(() => {});
      await execFileAsync("kubectl", ["config", "delete-user", ctx], { signal }).catch(() => {});
    }

    if (envContexts.includes(currentCtx.trim())) {
      await execFileAsync("kubectl", ["config", "unset", "current-context"], { signal }).catch(
        () => {},
      );
    }

    console.log(`removed ${envContexts.join(", ")} from ${process.env["HOME"]}/.kube/config`);
  }

  static #isPortReachable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.connect(port, "localhost");
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
  }

  static async #readS3PortFromState(stateFile: string): Promise<number> {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(stateFile, "utf8");
    const state = z
      .looseObject({
        resources: z.array(
          z.object({
            instances: z.array(z.object({ attributes: z.looseObject({}) })).optional(),
            type: z.string(),
          }),
        ),
      })
      .parse(JSON.parse(raw));
    const container = state.resources.find((r) => r.type === "docker_container");
    const attrs = container?.instances?.[0]?.attributes;
    const port = z
      .object({ ports: z.array(z.object({ external: z.number(), internal: z.number() })) })
      .safeParse(attrs);
    if (!port.success) {
      throw new Error("no port found");
    }
    const apiPort = port.data.ports.find((p) => p.internal === 9000)?.external;
    if (apiPort === undefined) {
      throw new Error("no api port found");
    }
    return apiPort;
  }
}
