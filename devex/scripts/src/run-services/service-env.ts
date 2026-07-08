import path from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";

const GEO_CACHE_FOLDER = path.resolve(import.meta.dirname, "appi-geo-cache");

const CredentialsSchema = z.object({
  password: z.string().min(1),
  username: z.string().min(1),
});

const RedirectEntrySchema = z.object({
  from: z.object({ host: z.string().min(1), port: z.number() }),
  to: z.object({ host: z.string().min(1), port: z.number() }),
});

const ServiceEntrySchema = z.object({
  host: z.string().min(1),
  port: z.number(),
  redirects: z
    .object({
      description: z.string(),
      dns: z.array(RedirectEntrySchema),
      ip: z.array(RedirectEntrySchema),
    })
    .optional(),
});

const MappingFileSchema = z.object({
  createdAt: z.string().optional(),
  credentials: z
    .record(
      z.string(),
      z.object({
        cassandra: CredentialsSchema.optional(),
        elasticsearch: CredentialsSchema.optional(),
      }),
    )
    .default({}),
  env: z.string().min(1),
  error: z.string().optional(),
  services: z.record(z.string(), ServiceEntrySchema),
  subenv: z.string().default("main"),
});

type MappingFile = z.infer<typeof MappingFileSchema>;
type ServiceEntry = z.infer<typeof ServiceEntrySchema>;

type Env = "local" | "dev" | "stg" | "prod";
type Service = "appi";

interface ServiceEnvArgs {
  readonly env: Env;
  readonly subenv: string;
  readonly services: readonly Service[];
  readonly remoteElastic: boolean;
  readonly remoteKafka: boolean;
  readonly remoteRedis: boolean;
  readonly remoteCassandra: boolean;
  readonly kafkaConsumerGroupPrefix: string;
  readonly useLatestGeoInAppi: boolean;
}

interface ServiceEnvVars {
  readonly ENV: Env;
  readonly SUBENV: string;
  readonly KAFKA_CONSUMER_GROUP_PREFIX: string;
  readonly RUN_SERVICES: string;
  readonly ENABLE_API: string;
  readonly ENABLE_FLIPT: string;
  readonly ENABLE_REPORTER: string;
  readonly ENABLE_INIT_DEFAULT_APP_RESOURCES: string;
  readonly JWKS_URL: string;
  readonly ELASTICSEARCH_URI: string;
  readonly KAFKA_BROKERS: string;
  readonly SCHEMA_REGISTRY_URL: string;
  readonly REDIS_URI: string;
  readonly AUTH_URL: string;
  readonly INTEGRATION_URL: string;
  readonly DETECTOR_URL: string;
  readonly PRIO_URL: string;
  readonly CRUMBS_URL: string;
  readonly FLIPT_URL: string;
  readonly APPI_URL: string;
  readonly LEADER_URL: string;
  readonly TEMPO_URL: string;
  readonly VICTORIA_METRICS_URL: string;
  readonly S3_TEST_ENDPOINT: string;
  readonly CASSANDRA_URIS: string;
  readonly APPI_GEO_CACHE_FOLDER_PATH?: string;
}

class ServiceEnv {
  public readonly mapping: MappingFile;
  readonly #args: ServiceEnvArgs;

  public constructor({ mapping, args }: { mapping: MappingFile; args: ServiceEnvArgs }) {
    this.mapping = mapping;
    this.#args = args;
  }

  public static async loadMapping(ac: AbortController): Promise<MappingFile> {
    const mappingPath = process.env["NODEJS_REDIRECT_MAPPING_FILE_PATH"];
    if (!mappingPath) {
      throw new Error(
        `NODEJS_REDIRECT_MAPPING_FILE_PATH is not set — sweetkit port-forward must run first, and direnv must be active`,
      );
    }
    const content = await readFile(mappingPath, { encoding: "utf8", signal: ac.signal });
    return MappingFileSchema.parse(JSON.parse(content));
  }

  /** Compute all env vars (common + per-service) as a typed object. */
  public computeEnv(): ServiceEnvVars {
    return {
      ...this.#commonEnv(),
      ...this.#perServiceEnv(),
    };
  }

  /** Apply all env vars to process.env. */
  public apply(): void {
    Object.assign(process.env, this.computeEnv());
  }

  /** Get host:port string for a service. */
  #endpoint(name: string): string {
    const s = this.mapping.services[name];
    if (!s) {
      throw new Error(`service "${name}" not in mapping file`);
    }
    return `${s.host}:${s.port}`;
  }

  /** Get host:port string for a service, with fallback. */
  #endpointOrDefault({ name, fallback }: { name: string; fallback: string }): string {
    const s = this.mapping.services[name];
    if (s) {
      return `${s.host}:${s.port}`;
    }
    return fallback;
  }

  #elasticCredentials(svc: Service): { username: string; password: string } {
    const c = this.mapping.credentials[svc]?.elasticsearch;
    if (!c) {
      throw new Error(
        `elasticsearch credentials for "${svc}" not in mapping file — re-run sweetkit port-forward`,
      );
    }
    return c;
  }

  #cassandraCredentials(svc: Service): { username: string; password: string } {
    const c = this.mapping.credentials[svc]?.cassandra;
    if (!c) {
      throw new Error(
        `cassandra credentials for "${svc}" not in mapping file — re-run sweetkit port-forward`,
      );
    }
    return c;
  }

  /** Collect all DNS redirect FQDNs matching a prefix (e.g. "kafka-controller"). */
  #dnsRedirectFqdns(prefix: string): readonly string[] {
    const fqdns: string[] = [];
    for (const svc of Object.values(this.mapping.services)) {
      if (svc.redirects) {
        for (const r of svc.redirects.dns) {
          if (r.from.host.startsWith(`${prefix}-`)) {
            fqdns.push(r.from.host);
          }
        }
      }
    }
    return fqdns;
  }

  #requireDnsRedirectFqdns({ prefix, flag }: { prefix: string; flag: string }): readonly string[] {
    const fqdns = this.#dnsRedirectFqdns(prefix);
    if (fqdns.length === 0) {
      throw new Error(`${flag} requested but no ${prefix}-* dns redirects in mapping file`);
    }
    return fqdns;
  }

  #firstService(): Service {
    const [svc] = this.#args.services;
    if (!svc) {
      throw new Error("services list is empty");
    }
    return svc;
  }

  /** Env vars that don't depend on which service we're booting. */
  #commonEnv(): Omit<ServiceEnvVars, "CASSANDRA_URIS"> {
    let elasticsearchUri: string;
    if (this.#args.remoteElastic) {
      const { username, password } = this.#elasticCredentials(this.#firstService());
      elasticsearchUri = `http://${username}:${password}@${this.#endpoint("elasticsearch-es-http")}`;
    } else {
      elasticsearchUri = "http://elastic:elastic@localhost:19200";
    }
    let kafkaBrokers: string;
    if (this.#args.remoteKafka) {
      kafkaBrokers = this.#requireDnsRedirectFqdns({
        flag: "remoteKafka",
        prefix: "kafka-controller",
      })
        .map((f) => `${f}:9092`)
        .join(",");
    } else {
      kafkaBrokers = "localhost:17492";
    }
    let redisUri: string;
    if (this.#args.remoteRedis) {
      redisUri = `redis://${this.#endpoint("redis-0")}`;
    } else {
      redisUri = "redis://localhost:16479";
    }
    let schemaRegistryUrl: string;
    if (this.#args.remoteKafka) {
      schemaRegistryUrl = `http://${this.#endpoint("schema-registry")}`;
    } else {
      schemaRegistryUrl = "http://localhost:18081";
    }
    let geoCacheExtras: { APPI_GEO_CACHE_FOLDER_PATH: string } | Record<string, never>;
    if (this.#args.useLatestGeoInAppi) {
      geoCacheExtras = {};
    } else {
      geoCacheExtras = { APPI_GEO_CACHE_FOLDER_PATH: GEO_CACHE_FOLDER };
    }
    return {
      APPI_URL: `http://${this.#endpointOrDefault({ fallback: "localhost:5788", name: "appi" })}`,
      AUTH_URL: `http://${this.#endpoint("auth")}`,
      CRUMBS_URL: `http://${this.#endpoint("crumbs")}`,
      DETECTOR_URL: `http://${this.#endpoint("detector")}`,
      ELASTICSEARCH_URI: elasticsearchUri,
      ENABLE_API: "true",
      ENABLE_FLIPT: "true",
      ENABLE_INIT_DEFAULT_APP_RESOURCES: "false",
      ENABLE_REPORTER: "false",
      ENV: this.#args.env,
      FLIPT_URL: `http://${this.#endpoint("flipt")}`,
      INTEGRATION_URL: `http://${this.#endpoint("integration")}`,
      JWKS_URL: "https://frontegg.stg.platinum-sec.com/.well-known/jwks.json",
      KAFKA_BROKERS: kafkaBrokers,
      KAFKA_CONSUMER_GROUP_PREFIX: this.#args.kafkaConsumerGroupPrefix,
      LEADER_URL: `http://${this.#endpointOrDefault({ fallback: "localhost:14040", name: "leader" })}`,
      PRIO_URL: `http://${this.#endpoint("prio")}`,
      REDIS_URI: redisUri,
      RUN_SERVICES: "true",
      S3_TEST_ENDPOINT: `http://${this.#endpointOrDefault({ fallback: "localhost:19000", name: "minio" })}`,
      SCHEMA_REGISTRY_URL: schemaRegistryUrl,
      SUBENV: this.#args.subenv,
      TEMPO_URL: `http://${this.#endpointOrDefault({ fallback: "localhost:14318", name: "tempo" })}`,
      VICTORIA_METRICS_URL: `http://${this.#endpointOrDefault({ fallback: "localhost:18428", name: "victoria-metrics" })}`,
      ...geoCacheExtras,
    };
  }

  /** Env vars whose value depends on the service being booted. */
  #perServiceEnv(): Pick<ServiceEnvVars, "CASSANDRA_URIS"> {
    const svc = this.#firstService();
    const keyspace = `${this.#args.subenv}__${svc}`;
    const dc = "datacenter1";
    let cassandraUris: string;
    if (this.#args.remoteCassandra) {
      const { username, password } = this.#cassandraCredentials(svc);
      cassandraUris = this.#requireDnsRedirectFqdns({
        flag: "remoteCassandra",
        prefix: "cassandra",
      })
        .map((f) => `cassandra://${username}:${password}@${f}:9042/${keyspace}?dc=${dc}`)
        .join(",");
    } else {
      cassandraUris = `cassandra://cassandra:cassandra@localhost:19042/${keyspace}?dc=${dc}`;
    }
    return {
      CASSANDRA_URIS: cassandraUris,
    };
  }
}

export { MappingFileSchema, ServiceEnv };
export type { Env, MappingFile, Service, ServiceEntry, ServiceEnvArgs, ServiceEnvVars };
