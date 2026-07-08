import { Command } from "@commander-js/extra-typings";
import { GetInitialIdentitiesCommand } from "./get-initial-identities-and-bots/get-initial-identities-command.ts";
import { KubectlLoginCommand } from "./kubectl-login.ts";
import { KubectlLogoutCommand } from "./kubectl-logout.ts";
import { PulumiDeleteCommand } from "./pulumi-delete.ts";
import { PulumiUpCommand } from "./pulumi-up.ts";

export interface DevopsCommandOpts {
  readonly signal: AbortSignal;
  readonly repoRoot: string;
}

export class DevopsCommand {
  readonly #args: DevopsCommandOpts;

  public constructor(args: DevopsCommandOpts) {
    this.#args = args;
  }

  public register(parent: Command): void {
    const { signal, repoRoot } = this.#args;
    const devops = new Command("devops").description("DevOps operations");
    new GetInitialIdentitiesCommand({ repoRoot, signal }).register(devops);
    new KubectlLoginCommand({ repoRoot, signal }).register(devops);
    new KubectlLogoutCommand({ repoRoot, signal }).register(devops);
    new PulumiDeleteCommand({ repoRoot, signal }).register(devops);
    new PulumiUpCommand({ repoRoot, signal }).register(devops);
    parent.addCommand(devops);
  }
}
