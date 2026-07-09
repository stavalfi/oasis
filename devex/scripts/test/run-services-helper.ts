import type { ChildProcess, PromiseWithChild } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server as HttpServer } from "node:http";
import type { MappingFile } from "../src/run-services/service-env.ts";
import type { Server } from "node:net";
// eslint-disable-next-line no-duplicate-imports
import { createServer as createHttpServer } from "node:http";
// eslint-disable-next-line no-duplicate-imports
import { createServer } from "node:net";
// eslint-disable-next-line no-duplicate-imports
import { exec } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { tmpdir } from "node:os";

const execAsync = promisify(exec);

const ROOT = path.resolve(import.meta.dirname, "../../..");
const START_APPI = path.resolve(ROOT, "docs/onboarding/setup/shell-aliases/start:appi");

const TCP_SERVICES = [
  "elasticsearch-es-http",
  "schema-registry",
  "redis-0",
  "auth",
  "integration",
  "detector",
  "prio",
  "crumbs",
  "flipt",
  "kafka",
  "cassandra",
  "leader",
  "tempo",
  "victoria-metrics",
  "minio",
] as const;

const HTTP_SERVICES = ["appi"] as const;

export class RunServicesTestHelper {
  readonly #servers = new Map<string, Server | HttpServer>();
  public readonly ports = new Map<string, number>();
  readonly #httpServices: ReadonlySet<string>;
  readonly #children: ChildProcess[] = [];
  readonly #tmpDir: string;
  public readonly mappingPath: string;
  public readonly gossPath: string;
  public readonly appiRepoPath: string;

  public constructor({
    tmpDir,
    httpServices,
  }: {
    tmpDir: string;
    httpServices: ReadonlySet<string>;
  }) {
    this.#tmpDir = tmpDir;
    this.#httpServices = httpServices;
    this.mappingPath = path.join(tmpDir, "mapping.json");
    this.gossPath = path.join(tmpDir, "goss.yaml");
    this.appiRepoPath = path.join(tmpDir, "appi");
  }

  public static async create(
    fixture: Pick<MappingFile, "env" | "subenv"> & {
      credentials?: MappingFile["credentials"];
      addRedirects?: readonly { serviceName: string; fqdn: string }[];
      error?: string;
    },
  ): Promise<RunServicesTestHelper> {
    const tmpDir = await mkdtemp(path.join(tmpdir(), "run-services-e2e-"));
    const httpServiceSet: ReadonlySet<string> = new Set(HTTP_SERVICES);
    const helper = new RunServicesTestHelper({ httpServices: httpServiceSet, tmpDir });

    const [entries] = await Promise.all([
      Promise.all([
        ...TCP_SERVICES.map((n) => this.#listenTcp(n)),
        ...HTTP_SERVICES.map((n) => this.#listenHttp(n)),
      ]),
      mkdir(path.join(helper.appiRepoPath, "src"), { recursive: true }).then(() =>
        writeFile(path.join(helper.appiRepoPath, "src/index.ts"), "// noop\n"),
      ),
    ]);

    for (const e of entries) {
      helper.#servers.set(e.name, e.server);
      helper.ports.set(e.name, e.port);
    }
    const services: MappingFile["services"] = {};
    for (const e of entries) {
      services[e.name] = { host: "127.0.0.1", port: e.port };
    }

    // Add redirect entries for services that need them (e.g. kafka, cassandra in remote mode)
    for (const r of fixture.addRedirects ?? []) {
      const svc = services[r.serviceName];
      if (svc) {
        svc.redirects = {
          description: "test redirect",
          dns: [{ from: { host: r.fqdn, port: svc.port }, to: { host: svc.host, port: svc.port } }],
          ip: [],
        };
      }
    }

    const mapping: MappingFile = { ...fixture, credentials: fixture.credentials ?? {}, services };
    await writeFile(helper.mappingPath, JSON.stringify(mapping));

    return helper;
  }

  public runAppi(args: string[]): PromiseWithChild<{ stdout: string; stderr: string }> {
    const ps = execAsync(
      [
        START_APPI,
        "--appi-repo-path",
        this.appiRepoPath,
        "--liveness-delay-seconds",
        "0",
        "--liveness-interval-seconds",
        "0.1",
        ...args,
      ].join(" "),
      {
        env: {
          ...process.env,
          GOSS_OUTPUT_PATH: this.gossPath,
          NODEJS_REDIRECT_MAPPING_FILE_PATH: this.mappingPath,
        },
      },
    );
    this.#children.push(ps.child);
    return ps;
  }

  public waitForOutput({ child, match }: { child: ChildProcess; match: string }): Promise<void> {
    if (!this.#children.includes(child)) {
      throw new Error(`waitForOutput: child pid=${child.pid} is not tracked by this helper`);
    }
    const { stdout } = child;
    if (!stdout) {
      throw new Error(`waitForOutput: child pid=${child.pid} has no stdout stream`);
    }
    return RunServicesTestHelper.#waitForStream({ child, match, stream: stdout });
  }

  public async runAppiExpectFailure(args: string[]): Promise<string> {
    try {
      await this.runAppi(args);
      throw new Error("Expected process to fail but it succeeded");
    } catch (error) {
      if (error instanceof Error && "stderr" in error) {
        return String(error.stderr);
      }
      throw error;
    }
  }

  public async runAppiAndGetEnv(args: string[]): Promise<Record<string, string>> {
    const { stdout } = await this.runAppi(["--only-print-env", ...args]);
    return JSON.parse(stdout);
  }

  public async runAppiAndGetGoss(args: string[]): Promise<string> {
    const { stdout } = await this.runAppi(["--only-generate-goss", ...args]);
    return stdout;
  }

  public stopService(name: string): void {
    const server = this.#servers.get(name);
    if (!server) {
      throw new Error(`Unknown service: ${name}`);
    }
    server.close();
    this.#servers.delete(name);
  }

  public async restartService(name: string): Promise<void> {
    const port = this.ports.get(name);
    if (port === undefined) {
      throw new Error(`Unknown service: ${name}`);
    }
    let server: Server | HttpServer;
    if (this.#httpServices.has(name)) {
      server = createHttpServer((_req, res) => {
        res.writeHead(200);
        res.end();
      });
    } else {
      server = createServer();
    }
    await new Promise<void>((resolve) => {
      server.listen(port, "127.0.0.1", resolve);
    });
    this.#servers.set(name, server);
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    const killChildren = async (): Promise<void> => {
      const pidGroups = await Promise.all(
        this.#children.map(async (c) => {
          if (!c.pid) {
            return [];
          }
          const pids = [String(c.pid)];
          try {
            const { stdout } = await execAsync(`pgrep -P ${c.pid}`);
            const children = stdout.trim().split("\n").filter(Boolean);
            await Promise.all(
              children.map(async (pid) => {
                pids.push(pid);
                try {
                  const { stdout: gc } = await execAsync(`pgrep -P ${pid}`);
                  pids.push(...gc.trim().split("\n").filter(Boolean));
                } catch {
                  /* No grandchildren */
                }
              }),
            );
          } catch {
            /* No children */
          }
          return pids;
        }),
      );
      const allPids = pidGroups.flat();

      if (allPids.length > 0) {
        try {
          await execAsync(`kill -9 ${allPids.join(" ")}`);
        } catch {
          /* Already dead */
        }
      }

      for (const c of this.#children) {
        c.stdout?.removeAllListeners();
        c.stderr?.removeAllListeners();
        c.removeAllListeners();
        c.stdout?.destroy();
        c.stderr?.destroy();
        c.unref();
      }
    };

    await Promise.all([
      killChildren(),
      ...[...this.#servers.values()].map(
        (s) =>
          new Promise<void>((resolve) => {
            s.close(() => resolve());
          }),
      ),
      rm(this.#tmpDir, { force: true, recursive: true }),
    ]);
  }

  static #waitForStream({
    child,
    stream,
    match,
  }: {
    child: ChildProcess;
    stream: NodeJS.ReadableStream;
    match: string;
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        stream.removeListener("data", onData);
        child.removeListener("close", onClose);
      };
      const onData = (chunk: Buffer): void => {
        if (chunk.toString().includes(match)) {
          cleanup();
          resolve();
        }
      };
      const onClose = (): void => {
        cleanup();
        reject(new Error(`pid=${child.pid} exited before match "${match}".`));
      };
      stream.on("data", onData);
      child.on("close", onClose);
    });
  }

  static #getPort(server: Server | HttpServer): number {
    const addr = server.address();
    if (addr === null || typeof addr === "string") {
      throw new Error("unexpected address type");
    }
    return addr.port;
  }

  static #listenTcp(name: string): Promise<{ name: string; server: Server; port: number }> {
    const server = createServer();
    return new Promise<{ name: string; server: Server; port: number }>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve({ name, port: this.#getPort(server), server }));
    });
  }

  static #listenHttp(name: string): Promise<{ name: string; server: HttpServer; port: number }> {
    const server = createHttpServer((_req, res) => {
      res.writeHead(200);
      res.end();
    });
    return new Promise<{ name: string; server: HttpServer; port: number }>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve({ name, port: this.#getPort(server), server }));
    });
  }
}
