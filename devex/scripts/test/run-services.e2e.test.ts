import { RunServicesTestHelper } from "./run-services-helper.ts";
import { strict as assert } from "node:assert";
import { test } from "node:test";

test("run-services e2e", { concurrency: true }, (t) => {
  t.test("liveness reports all services up", async () => {
    await using helper = await RunServicesTestHelper.create({
      env: "stg",
      subenv: "main",
    });

    const ps = helper.runAppi(["--env", "stg"]);
    await helper.waitForOutput({ child: ps.child, match: "All services are up" });
  });

  t.test("fails when env mismatches mapping file", async () => {
    await using helper = await RunServicesTestHelper.create({
      env: "stg",
      subenv: "main",
    });

    const stderr = await helper.runAppiExpectFailure(["--env", "dev", "--subenv", "my-subenv"]);
    assert.ok(stderr.includes("port-forward is running against stg but --env dev was requested"));
  });

  t.test("fails when mapping has error field", async () => {
    await using helper = await RunServicesTestHelper.create({
      env: "stg",
      error: "subenv not specified for dev — credentials unavailable",
      subenv: "main",
    });

    const stderr = await helper.runAppiExpectFailure(["--env", "stg"]);
    assert.ok(stderr.includes("subenv not specified for dev"));
  });

  t.test("detects a service that is down", async () => {
    await using helper = await RunServicesTestHelper.create({
      env: "stg",
      subenv: "main",
    });

    helper.stopService("leader");

    const ps = helper.runAppi(["--env", "stg"]);
    await helper.waitForOutput({ child: ps.child, match: "Some services are down" });
  });

  t.test("local mode: all env vars use docker-compose defaults", async () => {
    await using helper = await RunServicesTestHelper.create({
      env: "stg",
      subenv: "main",
    });

    const env = await helper.runAppiAndGetEnv(["--env", "stg"]);
    const p = (name: string): number | undefined => helper.ports.get(name);

    assert.equal(env["ENV"], "stg");
    assert.equal(env["SUBENV"], "main");
    assert.equal(env["KAFKA_CONSUMER_GROUP_PREFIX"], "");
    assert.equal(env["RUN_SERVICES"], "true");
    assert.equal(env["ENABLE_API"], "true");
    assert.equal(env["ENABLE_FLIPT"], "true");
    assert.equal(env["ENABLE_REPORTER"], "false");
    assert.equal(env["ENABLE_INIT_DEFAULT_APP_RESOURCES"], "false");
    assert.equal(env["JWKS_URL"], "https://frontegg.stg.platinum-sec.com/.well-known/jwks.json");
    assert.equal(env["ELASTICSEARCH_URI"], "http://elastic:elastic@localhost:19200");
    assert.equal(env["KAFKA_BROKERS"], "localhost:17492");
    assert.equal(env["SCHEMA_REGISTRY_URL"], "http://localhost:18081");
    assert.equal(env["REDIS_URI"], "redis://localhost:16479");
    assert.equal(env["AUTH_URL"], `http://127.0.0.1:${p("auth")}`);
    assert.equal(env["INTEGRATION_URL"], `http://127.0.0.1:${p("integration")}`);
    assert.equal(env["DETECTOR_URL"], `http://127.0.0.1:${p("detector")}`);
    assert.equal(env["PRIO_URL"], `http://127.0.0.1:${p("prio")}`);
    assert.equal(env["CRUMBS_URL"], `http://127.0.0.1:${p("crumbs")}`);
    assert.equal(env["FLIPT_URL"], `http://127.0.0.1:${p("flipt")}`);
    assert.equal(env["APPI_URL"], `http://127.0.0.1:${p("appi")}`);
    assert.equal(env["LEADER_URL"], `http://127.0.0.1:${p("leader")}`);
    assert.equal(env["TEMPO_URL"], `http://127.0.0.1:${p("tempo")}`);
    assert.equal(env["VICTORIA_METRICS_URL"], `http://127.0.0.1:${p("victoria-metrics")}`);
    assert.equal(env["S3_TEST_ENDPOINT"], `http://127.0.0.1:${p("minio")}`);
    assert.equal(
      env["CASSANDRA_URIS"],
      "cassandra://cassandra:cassandra@localhost:19042/main__appi?dc=datacenter1",
    );
  });

  t.test("remote elastic: uses mapping endpoint and CRD credentials", async () => {
    await using helper = await RunServicesTestHelper.create({
      credentials: {
        appi: {
          elasticsearch: { password: "es-pass", username: "es-user" },
        },
      },
      env: "stg",
      subenv: "main",
    });

    const env = await helper.runAppiAndGetEnv(["--env", "stg", "--remoteElastic"]);
    const p = (name: string): number | undefined => helper.ports.get(name);

    assert.equal(env["ENV"], "stg");
    assert.equal(env["SUBENV"], "main");
    assert.equal(
      env["ELASTICSEARCH_URI"],
      `http://es-user:es-pass@127.0.0.1:${p("elasticsearch-es-http")}`,
    );
    assert.equal(env["KAFKA_BROKERS"], "localhost:17492");
    assert.equal(env["SCHEMA_REGISTRY_URL"], "http://localhost:18081");
    assert.equal(env["REDIS_URI"], "redis://localhost:16479");
    assert.equal(env["AUTH_URL"], `http://127.0.0.1:${p("auth")}`);
    assert.equal(env["INTEGRATION_URL"], `http://127.0.0.1:${p("integration")}`);
    assert.equal(env["DETECTOR_URL"], `http://127.0.0.1:${p("detector")}`);
    assert.equal(env["PRIO_URL"], `http://127.0.0.1:${p("prio")}`);
    assert.equal(env["CRUMBS_URL"], `http://127.0.0.1:${p("crumbs")}`);
    assert.equal(env["FLIPT_URL"], `http://127.0.0.1:${p("flipt")}`);
    assert.equal(
      env["CASSANDRA_URIS"],
      "cassandra://cassandra:cassandra@localhost:19042/main__appi?dc=datacenter1",
    );
  });

  t.test("remote cassandra: uses mapping endpoint and CRD credentials", async () => {
    await using helper = await RunServicesTestHelper.create({
      addRedirects: [
        {
          fqdn: "cassandra-0.cassandra-headless.infra.svc.cluster.local",
          serviceName: "cassandra",
        },
      ],
      credentials: {
        appi: {
          cassandra: { password: "cass-pass", username: "cass-user" },
        },
      },
      env: "stg",
      subenv: "main",
    });

    const env = await helper.runAppiAndGetEnv(["--env", "stg", "--remoteCassandra"]);
    const p = (name: string): number | undefined => helper.ports.get(name);

    assert.equal(env["ENV"], "stg");
    assert.equal(env["SUBENV"], "main");
    assert.equal(env["ELASTICSEARCH_URI"], "http://elastic:elastic@localhost:19200");
    assert.equal(env["KAFKA_BROKERS"], "localhost:17492");
    assert.equal(env["SCHEMA_REGISTRY_URL"], "http://localhost:18081");
    assert.equal(env["REDIS_URI"], "redis://localhost:16479");
    assert.equal(env["AUTH_URL"], `http://127.0.0.1:${p("auth")}`);
    assert.equal(env["INTEGRATION_URL"], `http://127.0.0.1:${p("integration")}`);
    assert.equal(env["DETECTOR_URL"], `http://127.0.0.1:${p("detector")}`);
    assert.equal(env["PRIO_URL"], `http://127.0.0.1:${p("prio")}`);
    assert.equal(env["CRUMBS_URL"], `http://127.0.0.1:${p("crumbs")}`);
    assert.equal(env["FLIPT_URL"], `http://127.0.0.1:${p("flipt")}`);
    assert.equal(
      env["CASSANDRA_URIS"],
      "cassandra://cass-user:cass-pass@cassandra-0.cassandra-headless.infra.svc.cluster.local:9042/main__appi?dc=datacenter1",
    );
  });

  t.test("print-goss generates valid goss yaml with all services", async () => {
    await using helper = await RunServicesTestHelper.create({
      env: "stg",
      subenv: "main",
    });

    const goss = await helper.runAppiAndGetGoss(["--env", "stg"]);
    const p = (name: string): number | undefined => helper.ports.get(name);

    // TCP checks — local mode uses hardcoded docker-compose ports for some,
    // Mapping ports for sweet services
    assert.ok(goss.includes("tcp://127.0.0.1:19200:"), "elasticsearch");
    assert.ok(goss.includes("tcp://127.0.0.1:18081:"), "schema-registry");
    assert.ok(goss.includes("tcp://127.0.0.1:16479:"), "redis");
    assert.ok(goss.includes("tcp://127.0.0.1:17492:"), "kafka");
    assert.ok(goss.includes("tcp://127.0.0.1:19042:"), "cassandra");
    assert.ok(goss.includes(`tcp://127.0.0.1:${p("auth")}:`), "auth");
    assert.ok(goss.includes(`tcp://127.0.0.1:${p("leader")}:`), "leader");

    // HTTP check for appi
    assert.ok(goss.includes(`http://127.0.0.1:${p("appi")}/:`), "appi http");

    // Frontegg external check
    assert.ok(goss.includes("tcp://frontegg.stg.platinum-sec.com:443:"));

    // Has yaml-language-server schema
    assert.ok(goss.includes("yaml-language-server"));

    // Has reachable checks
    assert.ok(goss.includes("reachable: true"));
  });

  t.test("recovers: up → down → up", async () => {
    await using helper = await RunServicesTestHelper.create({
      env: "stg",
      subenv: "main",
    });

    const ps = helper.runAppi(["--env", "stg"]);

    await helper.waitForOutput({ child: ps.child, match: "All services are up" });
    helper.stopService("leader");
    await helper.waitForOutput({ child: ps.child, match: "Some services are down" });
    await helper.restartService("leader");
    await helper.waitForOutput({ child: ps.child, match: "All services are up" });
  });
});
