import { type Command, Option } from "@commander-js/extra-typings";
import { PortParser } from "../../utils/port-parser.ts";
import { PulumiCliUtils } from "../pulumi-cli-utils.ts";
import { IdentitiesReport } from "./get-initial-identities-and-bots.ts";

export class GetInitialIdentitiesCommand {
  readonly #signal: AbortSignal;
  readonly #repoRoot: string;

  public constructor({ signal, repoRoot }: { signal: AbortSignal; repoRoot: string }) {
    this.#signal = signal;
    this.#repoRoot = repoRoot;
  }

  public register(parent: Command): void {
    parent
      .command("get-initial-identities")
      .description("Print all initial identities and bots with their Pulumi-generated passwords")
      .addOption(
        new Option("--env <env>", "environment name").choices(["local"]).makeOptionMandatory(),
      )
      .requiredOption("--namespace <namespace>", "namespace")
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
      .option("--json", "output as JSON instead of tables", false)
      .action(async (args) => {
        await this.#run({
          env: args.env,
          gatewayPort: args.gatewayPort,
          json: args.json,
          namespace: args.namespace,
          s3ApiPort: args.s3Port,
        });
      });
  }

  async #run(args: {
    readonly env: "local";
    readonly namespace: string;
    readonly gatewayPort: number;
    readonly s3ApiPort: number;
    readonly json: boolean;
  }): Promise<void> {
    this.#signal.throwIfAborted();
    PulumiCliUtils.validateNamespaceSegment({ label: "namespace", value: args.namespace });
    await new IdentitiesReport({
      env: args.env,
      gatewayPort: args.gatewayPort,
      json: args.json,
      namespace: args.namespace,
      repoRoot: this.#repoRoot,
      s3ApiPort: args.s3ApiPort,
      signal: this.#signal,
    }).run();
  }
}
