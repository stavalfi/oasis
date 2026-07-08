import { Command, Option } from "@commander-js/extra-typings";
import { type Env, type Service } from "./service-env.ts";

const ENVS = ["local", "dev", "stg", "prod"] as const;
const SUPPORTED_SERVICES = ["appi"] as const;

export interface CliArgs {
  readonly env: Env;
  readonly subenv: string;
  readonly services: readonly Service[];
  readonly remoteElastic: boolean;
  readonly remoteKafka: boolean;
  readonly remoteRedis: boolean;
  readonly remoteCassandra: boolean;
  readonly kafkaConsumerGroupPrefix: string;
  readonly appiRepoPath: string;
  readonly livenessDelaySeconds: number;
  readonly livenessIntervalSeconds: number;
  readonly useLatestGeoInAppi: boolean;
  readonly onlyPrintEnv: boolean;
  readonly onlyGenerateGoss: boolean;
}

export const CliBuilder = {
  buildCommand(action: (args: CliArgs) => Promise<void>): Command {
    return new Command("run-services")
      .description(
        "Boot a Sweet service locally with the right env wiring for the chosen target env.",
      )
      .addOption(
        new Option("--env <env>", "Target k8s cluster context")
          .choices(ENVS)
          .makeOptionMandatory(true),
      )
      .option(
        "--subenv <subenv>",
        'Subenv name (required when --env=dev; forced to "main" for local/stg/prod)',
        "",
      )
      .addOption(
        new Option("--services <services...>", "Sweet services to run (must include appi)")
          .choices(SUPPORTED_SERVICES)
          .makeOptionMandatory(true),
      )
      .option(
        "--remoteElastic",
        "Use port-forwarded elasticsearch instead of local docker-compose",
        false,
      )
      .option("--remoteKafka", "Use port-forwarded kafka instead of local docker-compose", false)
      .option("--remoteRedis", "Use port-forwarded redis instead of local docker-compose", false)
      .option(
        "--remoteCassandra",
        "Use port-forwarded cassandra instead of local docker-compose",
        false,
      )
      .option(
        "--kafkaConsumerGroupPrefix <prefix>",
        "Prefix prepended to the kafka consumer group id so you can consume the same topic again",
        "",
      )
      .requiredOption(
        "--appi-repo-path <path>",
        "Path to the appi repo (defaults to $APPI_REPO_PATH)",
        process.env["APPI_REPO_PATH"],
      )
      .option(
        "--liveness-delay-seconds <seconds>",
        "Seconds to wait before showing liveness errors",
        "10",
      )
      .option("--liveness-interval-seconds <seconds>", "Seconds between liveness checks", "1")
      .option(
        "--use-latest-geo-in-appi",
        "Download latest GeoIP databases from S3 on startup (~20s, cached for 15m). If false, uses pre-cached mmdb files from git (instant)",
        false,
      )
      .option(
        "--only-print-env",
        "Print computed env vars as JSON and exit (does not start appi)",
        false,
      )
      .option(
        "--only-generate-goss",
        "Generate the goss YAML file and print it to stdout (does not start appi)",
        false,
      )
      .action(async (args) => {
        if (!args.services.includes("appi")) {
          throw new Error(`--services must include "appi"`);
        }
        let subenv: string;
        if (args.env === "dev") {
          if (!args.subenv) {
            throw new Error(`--subenv is required when --env is dev`);
          }
          ({ subenv } = args);
        } else {
          if (args.subenv && args.subenv !== "main") {
            throw new Error(
              `--subenv must be "main" when --env is ${args.env} (got "${args.subenv}")`,
            );
          }
          subenv = "main";
        }
        await action({
          ...args,
          livenessDelaySeconds: Number(args.livenessDelaySeconds),
          livenessIntervalSeconds: Number(args.livenessIntervalSeconds),
          onlyGenerateGoss: args.onlyGenerateGoss,
          onlyPrintEnv: args.onlyPrintEnv,
          subenv,
          useLatestGeoInAppi: args.useLatestGeoInAppi,
        });
      });
  },
};
