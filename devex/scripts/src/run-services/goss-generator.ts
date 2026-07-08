import { type MappingFile, type ServiceEnvArgs, type ServiceEnvVars } from "./service-env.ts";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

interface Check {
  name: string;
  addr: string;
  originalAddr?: string;
  envVar?: string;
  envValue?: string;
  source: string;
  help: string;
}

export interface GossGeneratorOptions {
  readonly ac: AbortController;
  readonly args: ServiceEnvArgs;
  readonly env: ServiceEnvVars;
  readonly mapping: MappingFile;
}

export class GossGenerator {
  public readonly path: string = GossGenerator.#resolveOutputPath();
  readonly #ac: AbortController;
  readonly #args: ServiceEnvArgs;
  readonly #env: ServiceEnvVars;
  readonly #redirects: ReadonlyMap<string, string>;

  public constructor(options: GossGeneratorOptions) {
    this.#ac = options.ac;
    this.#args = options.args;
    this.#env = options.env;

    // Build redirect lookup from all services' redirect entries
    const redirectMap = new Map<string, string>();
    for (const svc of Object.values(options.mapping.services)) {
      if (svc.redirects) {
        for (const r of [...svc.redirects.dns, ...svc.redirects.ip]) {
          redirectMap.set(r.from.host, r.to.host);
        }
      }
    }
    this.#redirects = redirectMap;
  }

  public async generate(): Promise<void> {
    const tcpChecks = this.#tcpChecks();
    const httpChecks = this.#httpChecks();

    const lines: string[] = [
      "# yaml-language-server: $schema=https://raw.githubusercontent.com/goss-org/goss/master/docs/schema.yaml",
      `# Generated at ${new Date().toISOString()}`,
      "",
    ];

    if (tcpChecks.length > 0) {
      lines.push("addr:");
      for (const c of tcpChecks) {
        let envInfo: string;
        if (c.envVar) {
          envInfo = ` (${c.envVar}=${c.envValue})`;
        } else {
          envInfo = "";
        }
        let redirectInfo: string;
        if (c.originalAddr && c.originalAddr !== c.addr) {
          redirectInfo = ` [${c.originalAddr} ->${c.addr}]`;
        } else {
          redirectInfo = "";
        }
        lines.push(`  tcp://${c.addr}:`);
        lines.push(`    title: "${c.name} [${c.source}]${redirectInfo}${envInfo} -${c.help}"`);
        lines.push("    reachable: true");
        lines.push(`    timeout: ${GossGenerator.#timeout(c.source)}`);
        lines.push("");
      }
    }

    if (httpChecks.length > 0) {
      lines.push("http:");
      for (const c of httpChecks) {
        let envInfo: string;
        if (c.envVar) {
          envInfo = ` (${c.envVar}=${c.envValue})`;
        } else {
          envInfo = "";
        }
        lines.push(`  ${c.addr}:`);
        lines.push(`    title: "${c.name} [${c.source}]${envInfo} -${c.help}"`);
        lines.push("    status: 200");
        lines.push(`    timeout: ${GossGenerator.#timeout(c.source)}`);
        lines.push("");
      }
    }

    await mkdir(path.dirname(this.path), { recursive: true });
    await rm(this.path, { force: true });
    await writeFile(this.path, lines.join("\n"), { mode: 0o644, signal: this.#ac.signal });
  }

  #portForwardHelp(): string {
    return `run: npm run port-forward:${this.#args.env}`;
  }

  static #dockerComposeHelp(): string {
    return "run: npm run docker-compose:up";
  }

  static #hostPort(url: string): string {
    const u = new URL(url);
    let host: string;
    if (u.hostname === "localhost") {
      host = "127.0.0.1";
    } else {
      host = u.hostname;
    }
    return `${host}:${u.port}`;
  }

  /** Resolve a host:port through the redirect mapping (FQDN ->127.0.0.x). */
  #resolveAddr(hostPort: string): string {
    const lastColon = hostPort.lastIndexOf(":");
    let host: string;
    let port: string | undefined;
    if (lastColon === -1) {
      host = hostPort;
      port = undefined;
    } else {
      host = hostPort.slice(0, lastColon);
      port = hostPort.slice(lastColon + 1);
    }
    let fallback: string;
    if (host === "localhost") {
      fallback = "127.0.0.1";
    } else {
      fallback = host;
    }
    const resolved = this.#redirects.get(host) ?? fallback;
    if (port) {
      return `${resolved}:${port}`;
    }
    return resolved;
  }

  static #resolveOutputPath(): string {
    const fromEnv = process.env["GOSS_OUTPUT_PATH"];
    if (fromEnv) {
      return fromEnv;
    }
    const home = process.env["HOME"];
    if (!home) {
      throw new Error("HOME env var is not set — cannot resolve default GOSS_OUTPUT_PATH");
    }
    return path.resolve(home, "projects/output/run-services.goss-validator.yaml");
  }

  static #timeout(source: string): number {
    if (source.startsWith("local")) {
      return 5000;
    }
    return 10_000;
  }

  #tcpChecks(): Check[] {
    const pfHelp = this.#portForwardHelp();
    const dcHelp = GossGenerator.#dockerComposeHelp();
    const REMOTE_SOURCE = "remote /port-forwarded";
    const LOCAL_SOURCE = "local /docker-compose";

    let elasticHelp: string;
    let elasticSource: string;
    if (this.#args.remoteElastic) {
      elasticHelp = pfHelp;
      elasticSource = REMOTE_SOURCE;
    } else {
      elasticHelp = dcHelp;
      elasticSource = LOCAL_SOURCE;
    }
    let kafkaHelp: string;
    let kafkaSource: string;
    if (this.#args.remoteKafka) {
      kafkaHelp = pfHelp;
      kafkaSource = REMOTE_SOURCE;
    } else {
      kafkaHelp = dcHelp;
      kafkaSource = LOCAL_SOURCE;
    }
    let redisHelp: string;
    let redisSource: string;
    if (this.#args.remoteRedis) {
      redisHelp = pfHelp;
      redisSource = REMOTE_SOURCE;
    } else {
      redisHelp = dcHelp;
      redisSource = LOCAL_SOURCE;
    }
    let cassandraHelp: string;
    let cassandraSource: string;
    if (this.#args.remoteCassandra) {
      cassandraHelp = pfHelp;
      cassandraSource = REMOTE_SOURCE;
    } else {
      cassandraHelp = dcHelp;
      cassandraSource = LOCAL_SOURCE;
    }

    return [
      {
        addr: GossGenerator.#hostPort(this.#env.ELASTICSEARCH_URI),
        envValue: this.#env.ELASTICSEARCH_URI,
        envVar: "ELASTICSEARCH_URI",
        help: elasticHelp,
        name: "Elasticsearch",
        source: elasticSource,
      },
      {
        addr: GossGenerator.#hostPort(this.#env.SCHEMA_REGISTRY_URL),
        envValue: this.#env.SCHEMA_REGISTRY_URL,
        envVar: "SCHEMA_REGISTRY_URL",
        help: kafkaHelp,
        name: "Schema Registry",
        source: kafkaSource,
      },
      {
        addr: GossGenerator.#hostPort(this.#env.REDIS_URI),
        envValue: this.#env.REDIS_URI,
        envVar: "REDIS_URI",
        help: redisHelp,
        name: "Redis",
        source: redisSource,
      },
      {
        addr: GossGenerator.#hostPort(this.#env.AUTH_URL),
        envValue: this.#env.AUTH_URL,
        envVar: "AUTH_URL",
        help: pfHelp,
        name: "Auth service",
        source: "remote /port-forwarded",
      },
      {
        addr: GossGenerator.#hostPort(this.#env.INTEGRATION_URL),
        envValue: this.#env.INTEGRATION_URL,
        envVar: "INTEGRATION_URL",
        help: pfHelp,
        name: "Integration service",
        source: "remote /port-forwarded",
      },
      {
        addr: GossGenerator.#hostPort(this.#env.DETECTOR_URL),
        envValue: this.#env.DETECTOR_URL,
        envVar: "DETECTOR_URL",
        help: pfHelp,
        name: "Detector service",
        source: "remote /port-forwarded",
      },
      {
        addr: GossGenerator.#hostPort(this.#env.PRIO_URL),
        envValue: this.#env.PRIO_URL,
        envVar: "PRIO_URL",
        help: pfHelp,
        name: "Prio service",
        source: "remote /port-forwarded",
      },
      {
        addr: GossGenerator.#hostPort(this.#env.CRUMBS_URL),
        envValue: this.#env.CRUMBS_URL,
        envVar: "CRUMBS_URL",
        help: pfHelp,
        name: "Crumbs service",
        source: "remote /port-forwarded",
      },
      {
        addr: GossGenerator.#hostPort(this.#env.FLIPT_URL),
        envValue: this.#env.FLIPT_URL,
        envVar: "FLIPT_URL",
        help: pfHelp,
        name: "Flipt feature flags",
        source: "remote /port-forwarded",
      },
      {
        addr: GossGenerator.#hostPort(this.#env.LEADER_URL),
        envValue: this.#env.LEADER_URL,
        envVar: "LEADER_URL",
        help: dcHelp,
        name: "Leader election",
        source: "local /docker-compose",
      },
      {
        addr: GossGenerator.#hostPort(this.#env.TEMPO_URL),
        envValue: this.#env.TEMPO_URL,
        envVar: "TEMPO_URL",
        help: dcHelp,
        name: "Tempo tracing",
        source: "local /docker-compose",
      },
      {
        addr: GossGenerator.#hostPort(this.#env.VICTORIA_METRICS_URL),
        envValue: this.#env.VICTORIA_METRICS_URL,
        envVar: "VICTORIA_METRICS_URL",
        help: dcHelp,
        name: "Victoria Metrics",
        source: "local /docker-compose",
      },
      {
        addr: GossGenerator.#hostPort(this.#env.S3_TEST_ENDPOINT),
        envValue: this.#env.S3_TEST_ENDPOINT,
        envVar: "S3_TEST_ENDPOINT",
        help: dcHelp,
        name: "MinIO S3",
        source: "local /docker-compose",
      },
      ...this.#env.KAFKA_BROKERS.split(",").map((broker) => ({
        addr: this.#resolveAddr(broker),
        envValue: this.#env.KAFKA_BROKERS,
        envVar: "KAFKA_BROKERS",
        help: kafkaHelp,
        name: "Kafka broker",
        originalAddr: broker,
        source: kafkaSource,
      })),
      ...this.#env.CASSANDRA_URIS.split(",").map((uri) => ({
        addr: this.#resolveAddr(GossGenerator.#hostPort(uri)),
        envValue: this.#env.CASSANDRA_URIS,
        envVar: "CASSANDRA_URIS",
        help: cassandraHelp,
        name: "Cassandra",
        originalAddr: GossGenerator.#hostPort(uri),
        source: cassandraSource,
      })),
      {
        addr: "frontegg.stg.platinum-sec.com:443",
        envValue: this.#env.JWKS_URL,
        envVar: "JWKS_URL",
        help: "check internet connectivity or VPN",
        name: "Frontegg JWKS",
        source: "external /staging",
      },
    ];
  }

  #httpChecks(): Check[] {
    return [
      {
        addr: `http://${GossGenerator.#hostPort(this.#env.APPI_URL)}/`,
        envValue: this.#env.APPI_URL,
        envVar: "APPI_URL",
        help: "check appi process logs above for startup errors",
        name: "Appi HTTP server",
        source: "local /started by this script",
      },
    ];
  }
}
