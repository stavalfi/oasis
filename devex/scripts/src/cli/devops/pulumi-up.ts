import { type Command, Option } from "@commander-js/extra-typings";
import { execFile } from "node:child_process";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { PortParser } from "../utils/port-parser.ts";
import { PulumiCliUtils } from "./pulumi-cli-utils.ts";

const execFileAsync = promisify(execFile);

export interface PulumiUpCommandOpts {
  readonly signal: AbortSignal;
  readonly repoRoot: string;
}

export class PulumiUpCommand {
  readonly #signal: AbortSignal;
  readonly #repoRoot: string;

  public constructor(args: PulumiUpCommandOpts) {
    this.#signal = args.signal;
    this.#repoRoot = args.repoRoot;
  }

  public register(parent: Command): void {
    const cmd = parent
      .command("pulumi-up")
      .description(
        "Bring up the Pulumi stacks and merge the cluster's kubeconfig into ~/.kube/config",
      );

    cmd
      .command("local")
      .description("Bring up local (kind) stacks")
      .option("--namespace <namespace>", "namespace (defaults to branch segment)")
      .requiredOption("--cluster-name <name>", "kind cluster name")
      .addOption(
        new Option("--gateway-port <port>", "host port for the Istio gateway")
          .argParser(PortParser.parse)
          .makeOptionMandatory(),
      )
      .addOption(
        new Option("--api-server-port <port>", "host port for the kube-apiserver")
          .argParser(PortParser.parse)
          .makeOptionMandatory(),
      )
      .addOption(
        new Option("--s3-port <port>", "host port for the S3-compatible backend")
          .argParser(PortParser.parse)
          .makeOptionMandatory(),
      )
      .requiredOption(
        "--metallb-ip-pool <range>",
        "IP range inside the Kind bridge network (shared by all Kind containers — must be unique per cluster)",
      )
      .action(async (args) => {
        const { developer, namespace, branch } = await PulumiCliUtils.resolveDeveloperAndNamespace({
          explicitNamespace: args.namespace,
          repoRoot: this.#repoRoot,
          signal: this.#signal,
        });
        await this.#runLocal({
          apiServerPort: args.apiServerPort,
          branch,
          clusterName: args.clusterName,
          developer,
          gatewayPort: args.gatewayPort,
          metallbIpPool: args.metallbIpPool,
          namespace,
          s3ApiPort: args.s3Port,
        });
      });

    cmd
      .command("aws")
      .description("Bring up AWS (EKS) stacks")
      .option("--namespace <namespace>", "namespace (defaults to branch segment)")
      .requiredOption("--cluster-name <name>", "EKS cluster name")
      .requiredOption("--domain <domain>", "base domain for public endpoints")
      .requiredOption("--acme-email <email>", "email for Let's Encrypt ACME registration")
      .requiredOption("--aws-region <region>", "AWS region")
      .action(async (args) => {
        const { developer, namespace, branch } = await PulumiCliUtils.resolveDeveloperAndNamespace({
          explicitNamespace: args.namespace,
          repoRoot: this.#repoRoot,
          signal: this.#signal,
        });
        await this.#runAws({
          acmeEmail: args.acmeEmail,
          awsRegion: args.awsRegion,
          branch,
          clusterName: args.clusterName,
          developer,
          domain: args.domain,
          namespace,
        });
      });
  }

  async #runLocal(args: {
    readonly clusterName: string;
    readonly namespace: string;
    readonly developer: string;
    readonly branch: string;
    readonly gatewayPort: number;
    readonly apiServerPort: number;
    readonly s3ApiPort: number;
    readonly metallbIpPool: string;
  }): Promise<void> {
    const {
      clusterName,
      namespace,
      developer,
      branch,
      gatewayPort,
      apiServerPort,
      s3ApiPort,
      metallbIpPool,
    } = args;
    const env = "local" as const;
    const home = homedir();

    const mkcertCa = path.join(home, ".local/share/mkcert/rootCA.pem");
    await access(mkcertCa).catch(async () => {
      await PulumiCliUtils.runInherited({
        args: ["-install"],
        cmd: "mkcert",
        cwd: this.#repoRoot,
        signal: this.#signal,
      });
    });
    await this.#ensureS3Local({ namespace, repoRoot: this.#repoRoot, s3ApiPort });

    const backendUrl = PulumiCliUtils.pulumiBackendUrl({ env, s3ApiPort });
    const infraPassphrase = await PulumiCliUtils.decryptPassphrase({
      cwd: this.#repoRoot,
      secretRelPath: `devops/infra/secrets/pulumi-passphrase/${env}.yaml`,
      signal: this.#signal,
    });
    const infraDir = path.join(this.#repoRoot, "devops", "infra");
    const infraStack = env;
    const infraPulumiEnv = {
      ...process.env,
      PULUMI_BACKEND_URL: backendUrl,
      PULUMI_CONFIG_PASSPHRASE: infraPassphrase,
    };

    await this.#pulumiUp({
      config: [
        ["cluster-name", clusterName],
        ["gateway-host-port", String(gatewayPort)],
        ["api-server-port", String(apiServerPort)],
        ["metallb-ip-pool", metallbIpPool],
      ],
      dir: infraDir,
      pulumiEnv: infraPulumiEnv,
      stack: infraStack,
    });

    const matrixPassphrase = await PulumiCliUtils.decryptPassphrase({
      cwd: this.#repoRoot,
      secretRelPath: `devops/matrix/secrets/pulumi-passphrase/${env}.yaml`,
      signal: this.#signal,
    });
    const matrixDir = path.join(this.#repoRoot, "devops", "matrix");
    PulumiCliUtils.validateNamespaceSegment({ label: "namespace", value: namespace });
    const matrixStack = `${env}--${namespace}`;

    await this.#pulumiUp({
      config: [
        ["branch", branch],
        ["branch-author", developer],
        ["cluster-name", clusterName],
      ],
      dir: matrixDir,
      pulumiEnv: {
        ...process.env,
        PULUMI_BACKEND_URL: backendUrl,
        PULUMI_CONFIG_PASSPHRASE: matrixPassphrase,
      },
      stack: matrixStack,
    });

    await PulumiUpCommand.#mergeKubeconfig({
      home,
      infraStack,
      namespace,
      pulumiEnv: infraPulumiEnv,
      repoRoot: this.#repoRoot,
      signal: this.#signal,
    });
  }

  async #runAws(args: {
    readonly clusterName: string;
    readonly namespace: string;
    readonly developer: string;
    readonly branch: string;
    readonly domain: string;
    readonly acmeEmail: string;
    readonly awsRegion: string;
  }): Promise<void> {
    const { clusterName, namespace, developer, branch, domain, acmeEmail, awsRegion } = args;
    const env = "prod" as const;
    const home = homedir();

    await this.#ensureS3Prod({ awsRegion, repoRoot: this.#repoRoot });

    const backendUrl = PulumiCliUtils.pulumiBackendUrl({ env });
    const infraPassphrase = await PulumiCliUtils.decryptPassphrase({
      cwd: this.#repoRoot,
      secretRelPath: `devops/infra/secrets/pulumi-passphrase/${env}.yaml`,
      signal: this.#signal,
    });
    const [cloudflareApiToken, googleClientId, googleClientSecret] = await Promise.all([
      PulumiCliUtils.decryptSecret({
        cwd: this.#repoRoot,
        field: "token",
        secretRelPath: `devops/infra/secrets/cloudflare-api-token/${env}.yaml`,
        signal: this.#signal,
      }),
      PulumiCliUtils.decryptSecret({
        cwd: this.#repoRoot,
        field: "client_id",
        secretRelPath: `devops/infra/secrets/google-oauth/${env}.yaml`,
        signal: this.#signal,
      }),
      PulumiCliUtils.decryptSecret({
        cwd: this.#repoRoot,
        field: "client_secret",
        secretRelPath: `devops/infra/secrets/google-oauth/${env}.yaml`,
        signal: this.#signal,
      }),
    ]);
    const infraDir = path.join(this.#repoRoot, "devops", "infra");
    const infraStack = env;
    const infraPulumiEnv = {
      ...process.env,
      AWS_DEFAULT_REGION: awsRegion,
      CLOUDFLARE_API_TOKEN: cloudflareApiToken,
      GOOGLE_CLIENT_ID: googleClientId,
      GOOGLE_CLIENT_SECRET: googleClientSecret,
      PULUMI_BACKEND_URL: backendUrl,
      PULUMI_CONFIG_PASSPHRASE: infraPassphrase,
    };

    await this.#pulumiUp({
      config: [
        ["cluster-name", clusterName],
        ["domain", domain],
        ["acme-email", acmeEmail],
        ["aws-region", awsRegion],
      ],
      dir: infraDir,
      pulumiEnv: infraPulumiEnv,
      stack: infraStack,
    });

    const matrixPassphrase = await PulumiCliUtils.decryptPassphrase({
      cwd: this.#repoRoot,
      secretRelPath: `devops/matrix/secrets/pulumi-passphrase/${env}.yaml`,
      signal: this.#signal,
    });
    const matrixDir = path.join(this.#repoRoot, "devops", "matrix");
    PulumiCliUtils.validateNamespaceSegment({ label: "namespace", value: namespace });
    const matrixStack = `${env}--${namespace}`;

    await this.#pulumiUp({
      config: [
        ["branch", branch],
        ["branch-author", developer],
        ["cluster-name", clusterName],
      ],
      dir: matrixDir,
      pulumiEnv: {
        ...process.env,
        AWS_DEFAULT_REGION: awsRegion,
        PULUMI_BACKEND_URL: backendUrl,
        PULUMI_CONFIG_PASSPHRASE: matrixPassphrase,
      },
      stack: matrixStack,
    });

    await PulumiUpCommand.#mergeKubeconfig({
      home,
      infraStack,
      namespace,
      pulumiEnv: infraPulumiEnv,
      repoRoot: this.#repoRoot,
      signal: this.#signal,
    });
  }

  async #pulumiUp(args: {
    readonly dir: string;
    readonly stack: string;
    readonly config: [string, string][];
    readonly pulumiEnv: NodeJS.ProcessEnv;
  }): Promise<void> {
    const { dir, stack, config, pulumiEnv } = args;
    await PulumiCliUtils.runInherited({
      args: ["stack", "select", stack, "--create"],
      cmd: "pulumi",
      cwd: dir,
      env: pulumiEnv,
      signal: this.#signal,
    });
    for (const [key, value] of config) {
      await PulumiCliUtils.runInherited({
        args: ["config", "set", "--stack", stack, key, value],
        cmd: "pulumi",
        cwd: dir,
        env: pulumiEnv,
        signal: this.#signal,
      });
    }
    await PulumiCliUtils.runInherited({
      args: ["up", "--stack", stack, "--yes"],
      cmd: "pulumi",
      cwd: dir,
      env: pulumiEnv,
      signal: this.#signal,
    });
  }

  async #ensureS3Local(args: {
    readonly repoRoot: string;
    readonly namespace: string;
    readonly s3ApiPort: number;
  }): Promise<void> {
    const { repoRoot, namespace, s3ApiPort } = args;
    const tfDir = path.join(repoRoot, "devops", "s3-terraform", "local");
    const statesDir = path.join(homedir(), ".local", "share", "poc", "tofu");
    const stateFile = path.join(statesDir, `${namespace}.tfstate`);
    await mkdir(statesDir, { recursive: true });
    await PulumiCliUtils.runInherited({
      args: ["init", "-upgrade=false"],
      cmd: "tofu",
      cwd: tfDir,
      signal: this.#signal,
    });
    await PulumiCliUtils.runInherited({
      args: [
        "apply",
        "-auto-approve",
        `-state=${stateFile}`,
        `-var=namespace=${namespace}`,
        `-var=s3_api_port=${s3ApiPort}`,
      ],
      cmd: "tofu",
      cwd: tfDir,
      signal: this.#signal,
    });
  }

  async #ensureS3Prod(args: {
    readonly repoRoot: string;
    readonly awsRegion: string;
  }): Promise<void> {
    const { repoRoot, awsRegion } = args;
    const tfDir = path.join(repoRoot, "devops", "s3-terraform", "prod");
    const statesDir = path.join(homedir(), ".local", "share", "poc", "tofu");
    const stateFile = path.join(statesDir, "prod-s3.tfstate");
    const tofuEnv = { ...process.env, AWS_DEFAULT_REGION: awsRegion };
    await mkdir(statesDir, { recursive: true });
    await PulumiCliUtils.runInherited({
      args: ["init", "-upgrade=false"],
      cmd: "tofu",
      cwd: tfDir,
      env: tofuEnv,
      signal: this.#signal,
    });
    await PulumiCliUtils.runInherited({
      args: ["apply", "-auto-approve", `-state=${stateFile}`, `-var=aws_region=${awsRegion}`],
      cmd: "tofu",
      cwd: tfDir,
      env: tofuEnv,
      signal: this.#signal,
    });
  }

  static async #mergeKubeconfig(args: {
    readonly repoRoot: string;
    readonly home: string;
    readonly infraStack: string;
    readonly namespace: string;
    readonly pulumiEnv: NodeJS.ProcessEnv;
    readonly signal: AbortSignal;
  }): Promise<void> {
    const { repoRoot, home, infraStack, namespace, pulumiEnv, signal } = args;
    const { stdout: pocKubeconfig } = await execFileAsync(
      "pulumi",
      ["stack", "output", "--show-secrets", "--stack", infraStack, "kubeconfig"],
      { cwd: path.join(repoRoot, "devops", "infra"), env: pulumiEnv, signal },
    );

    const kubeConfigFile = path.join(home, ".kube/config");
    const tmpFile = path.join(tmpdir(), `poc-${infraStack}-${namespace}-kubeconfig.yaml`);
    try {
      await writeFile(tmpFile, pocKubeconfig);
      const { stdout: merged } = await execFileAsync("kubectl", ["config", "view", "--flatten"], {
        env: { ...process.env, KUBECONFIG: `${tmpFile}:${kubeConfigFile}` },
        signal,
      });
      await writeFile(kubeConfigFile, merged, { mode: 0o600 });
      console.log(`merged kubeconfig into ${kubeConfigFile}`);
    } finally {
      await rm(tmpFile, { force: true });
    }
  }
}
