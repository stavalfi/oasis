import { type CliArgs, CliBuilder } from "./cli-builder.ts";
import { type Service, ServiceEnv } from "./service-env.ts";
import { GossGenerator } from "./goss-generator.ts";
import { LivenessChecks } from "./liveness-checks.ts";
import path from "node:path";

class RunServices {
  readonly #ac = new AbortController();

  public constructor() {
    process.on("SIGTERM", () => this.#ac.abort());
  }

  async #run(args: CliArgs): Promise<void> {
    const mapping = await ServiceEnv.loadMapping(this.#ac);
    if (mapping.env !== args.env) {
      throw new Error(
        `port-forward is running against ${mapping.env} but --env ${args.env} was requested. Run: npm run port-forward:${args.env}`,
      );
    }
    if (mapping.error) {
      throw new Error(mapping.error);
    }
    const senv = new ServiceEnv({ args, mapping });
    const env = senv.computeEnv();

    if (args.onlyPrintEnv) {
      console.log(JSON.stringify(env, undefined, 2));
      return;
    }

    const goss = new GossGenerator({ ac: this.#ac, args, env, mapping: senv.mapping });
    await goss.generate();

    if (args.onlyGenerateGoss) {
      const { readFile } = await import("node:fs/promises");
      console.log(await readFile(goss.path, "utf8"));
      return;
    }

    senv.apply();

    const liveness = new LivenessChecks({
      ac: this.#ac,
      gossFilePath: goss.path,
      refreshIntervalSeconds: args.livenessIntervalSeconds,
      showFirstErrorAfterSeconds: args.livenessDelaySeconds,
    });

    await Promise.all([
      liveness.run(),
      ...args.services.map(
        // oxlint-disable-next-line import/no-dynamic-require -- path comes from a user-supplied CLI arg pointing to an external repo
        (svc) => import(RunServices.#entryPath({ appiRepoPath: args.appiRepoPath, svc })),
      ),
    ]);
  }

  static #entryPath({ appiRepoPath, svc }: { appiRepoPath: string; svc: Service }): string {
    switch (svc) {
      case "appi": {
        return path.resolve(appiRepoPath, "src/index.ts");
      }
    }
  }

  public static async main(): Promise<void> {
    const app = new RunServices();
    await CliBuilder.buildCommand((args) => app.#run(args)).parseAsync(process.argv);
  }
}

void RunServices.main();
