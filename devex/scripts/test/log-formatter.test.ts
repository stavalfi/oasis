import { describe, it } from "node:test";
import { promisify, stripVTControlCharacters } from "node:util";
import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import path from "node:path";

const execFileAsync = promisify(execFile);
const FORMATTER = path.resolve(import.meta.dirname, "../src/run-services/log-formatter.ts");

class LogFormatterHelper {
  public static formatTime(v: number | string): string {
    return new Date(v).toLocaleTimeString();
  }

  public static async format(input: string): Promise<string[]> {
    const { stdout } = await execFileAsync(
      "bash",
      ["-c", `printf '%s' "$INPUT" | node ${FORMATTER}`],
      { env: { ...process.env, INPUT: input }, timeout: 5000 },
    );
    return stdout
      .split("\n")
      .filter(Boolean)
      .map((s) => stripVTControlCharacters(s));
  }
}

describe("log-formatter", { concurrency: true }, () => {
  it("passes plain text through unchanged", async () => {
    const lines = await LogFormatterHelper.format("hello world\n");
    assert.deepEqual(lines, ["hello world"]);
  });

  it("formats JSON pino line as: [time] LEVEL (name): msg extras", async () => {
    const input = `${JSON.stringify({ level: 30, method: "GET", msg: "hello", name: "appi", time: 1_700_000_000_000 })}\n`;
    const lines = await LogFormatterHelper.format(input);
    assert.deepEqual(lines, [
      `[${LogFormatterHelper.formatTime(1_700_000_000_000)}] INFO (appi): hello method=GET`,
    ]);
  });

  it("no badge when status is unknown", async () => {
    const input = `${JSON.stringify({ level: 30, msg: "boot", name: "appi", time: 1_700_000_000_000 })}\n`;
    const lines = await LogFormatterHelper.format(input);
    assert.deepEqual(lines, [
      `[${LogFormatterHelper.formatTime(1_700_000_000_000)}] INFO (appi): boot`,
    ]);
  });

  it("UP badge appears on the liveness success line", async () => {
    const input = `${JSON.stringify({ level: 30, msg: "All services are up and running", name: "liveness", time: 1_700_000_000_000, uptime: "5s" })}\n`;
    const lines = await LogFormatterHelper.format(input);
    assert.deepEqual(lines, [
      ` UP  [${LogFormatterHelper.formatTime(1_700_000_000_000)}] INFO (liveness) [5s]: All services are up and running`,
    ]);
  });

  it("UP badge persists on subsequent lines", async () => {
    const input = `${[
      JSON.stringify({
        level: 30,
        msg: "All services are up and running",
        name: "liveness",
        time: 1_700_000_000_000,
      }),
      JSON.stringify({ level: 30, msg: "ready", name: "appi", time: 1_700_000_001_000 }),
    ].join("\n")}\n`;
    const lines = await LogFormatterHelper.format(input);
    assert.deepEqual(lines, [
      ` UP  [${LogFormatterHelper.formatTime(1_700_000_000_000)}] INFO (liveness): All services are up and running`,
      ` UP  [${LogFormatterHelper.formatTime(1_700_000_001_000)}] INFO (appi): ready`,
    ]);
  });

  it("DOWN badge on liveness error and subsequent lines", async () => {
    const input = `${[
      JSON.stringify({
        failures: "tcp://localhost:19200",
        level: 50,
        msg: "Some services are down",
        name: "liveness",
        time: 1_700_000_000_000,
      }),
      JSON.stringify({ level: 30, msg: "still going", name: "appi", time: 1_700_000_001_000 }),
    ].join("\n")}\n`;
    const lines = await LogFormatterHelper.format(input);
    assert.deepEqual(lines, [
      ` DOWN  [${LogFormatterHelper.formatTime(1_700_000_000_000)}] ERROR (liveness): Some services are down failures=tcp://localhost:19200`,
      ` DOWN  [${LogFormatterHelper.formatTime(1_700_000_001_000)}] INFO (appi): still going`,
    ]);
  });

  it("DOWN recovers to UP", async () => {
    const input = `${[
      JSON.stringify({
        level: 50,
        msg: "Some services are down",
        name: "liveness",
        time: 1_700_000_000_000,
      }),
      JSON.stringify({ level: 30, msg: "while down", name: "appi", time: 1_700_000_001_000 }),
      JSON.stringify({
        level: 30,
        msg: "All services are up and running",
        name: "liveness",
        time: 1_700_000_002_000,
      }),
      JSON.stringify({ level: 30, msg: "after recovery", name: "appi", time: 1_700_000_003_000 }),
    ].join("\n")}\n`;
    const lines = await LogFormatterHelper.format(input);
    assert.deepEqual(lines, [
      ` DOWN  [${LogFormatterHelper.formatTime(1_700_000_000_000)}] ERROR (liveness): Some services are down`,
      ` DOWN  [${LogFormatterHelper.formatTime(1_700_000_001_000)}] INFO (appi): while down`,
      ` UP  [${LogFormatterHelper.formatTime(1_700_000_002_000)}] INFO (liveness): All services are up and running`,
      ` UP  [${LogFormatterHelper.formatTime(1_700_000_003_000)}] INFO (appi): after recovery`,
    ]);
  });

  it("UP to DOWN to UP full cycle", async () => {
    const input = `${[
      JSON.stringify({
        level: 30,
        msg: "All services are up and running",
        name: "liveness",
        time: 1_700_000_000_000,
      }),
      JSON.stringify({
        level: 50,
        msg: "Some services are down",
        name: "liveness",
        time: 1_700_000_001_000,
      }),
      JSON.stringify({
        level: 30,
        msg: "All services are up and running",
        name: "liveness",
        time: 1_700_000_002_000,
      }),
    ].join("\n")}\n`;
    const lines = await LogFormatterHelper.format(input);
    assert.deepEqual(lines, [
      ` UP  [${LogFormatterHelper.formatTime(1_700_000_000_000)}] INFO (liveness): All services are up and running`,
      ` DOWN  [${LogFormatterHelper.formatTime(1_700_000_001_000)}] ERROR (liveness): Some services are down`,
      ` UP  [${LogFormatterHelper.formatTime(1_700_000_002_000)}] INFO (liveness): All services are up and running`,
    ]);
  });

  it("DOWN stays DOWN across multiple errors", async () => {
    const input = `${[
      JSON.stringify({
        level: 50,
        msg: "Some services are down",
        name: "liveness",
        time: 1_700_000_000_000,
      }),
      JSON.stringify({
        level: 50,
        msg: "Some services are down",
        name: "liveness",
        time: 1_700_000_001_000,
      }),
      JSON.stringify({ level: 30, msg: "log", name: "appi", time: 1_700_000_002_000 }),
    ].join("\n")}\n`;
    const lines = await LogFormatterHelper.format(input);
    assert.deepEqual(lines, [
      ` DOWN  [${LogFormatterHelper.formatTime(1_700_000_000_000)}] ERROR (liveness): Some services are down`,
      ` DOWN  [${LogFormatterHelper.formatTime(1_700_000_001_000)}] ERROR (liveness): Some services are down`,
      ` DOWN  [${LogFormatterHelper.formatTime(1_700_000_002_000)}] INFO (appi): log`,
    ]);
  });

  it("non-liveness errors do not change status", async () => {
    const input = `${[
      JSON.stringify({
        level: 30,
        msg: "All services are up and running",
        name: "liveness",
        time: 1_700_000_000_000,
      }),
      JSON.stringify({ level: 50, msg: "appi crash", name: "appi", time: 1_700_000_001_000 }),
      JSON.stringify({ level: 30, msg: "next", name: "appi", time: 1_700_000_002_000 }),
    ].join("\n")}\n`;
    const lines = await LogFormatterHelper.format(input);
    assert.deepEqual(lines, [
      ` UP  [${LogFormatterHelper.formatTime(1_700_000_000_000)}] INFO (liveness): All services are up and running`,
      ` UP  [${LogFormatterHelper.formatTime(1_700_000_001_000)}] ERROR (appi): appi crash`,
      ` UP  [${LogFormatterHelper.formatTime(1_700_000_002_000)}] INFO (appi): next`,
    ]);
  });

  it("liveness info that is not the success message does not set UP", async () => {
    const input = `${[
      JSON.stringify({
        level: 30,
        msg: "Running liveness checks...",
        name: "liveness",
        time: 1_700_000_000_000,
      }),
      JSON.stringify({ level: 30, msg: "boot", name: "appi", time: 1_700_000_001_000 }),
    ].join("\n")}\n`;
    const lines = await LogFormatterHelper.format(input);
    assert.deepEqual(lines, [
      `[${LogFormatterHelper.formatTime(1_700_000_000_000)}] INFO (liveness): Running liveness checks...`,
      `[${LogFormatterHelper.formatTime(1_700_000_001_000)}] INFO (appi): boot`,
    ]);
  });

  it("no timestamp when time field is missing", async () => {
    const input = `${JSON.stringify({ level: 30, msg: "no time", name: "appi" })}\n`;
    const lines = await LogFormatterHelper.format(input);
    assert.deepEqual(lines, ["INFO (appi): no time"]);
  });

  it("plain text lines are never modified even after status changes", async () => {
    const input = `${[
      JSON.stringify({
        level: 30,
        msg: "All services are up and running",
        name: "liveness",
        time: 1_700_000_000_000,
      }),
      "INFO: plain appi log childLoggerId=cassandra",
      JSON.stringify({
        level: 50,
        msg: "Some services are down",
        name: "liveness",
        time: 1_700_000_001_000,
      }),
      "S3 client initialized",
    ].join("\n")}\n`;
    const lines = await LogFormatterHelper.format(input);
    assert.deepEqual(lines, [
      ` UP  [${LogFormatterHelper.formatTime(1_700_000_000_000)}] INFO (liveness): All services are up and running`,
      "INFO: plain appi log childLoggerId=cassandra",
      ` DOWN  [${LogFormatterHelper.formatTime(1_700_000_001_000)}] ERROR (liveness): Some services are down`,
      "S3 client initialized",
    ]);
  });

  it("handles real appi output with string levels and ISO timestamps", async () => {
    const input = `${[
      '{"level":30,"time":"2026-05-08T15:58:09.007Z","name":"liveness","uptime":"0s","msg":"Running liveness checks..."}',
      '{"level":"debug","time":"2026-05-08T15:58:10.408Z","childLoggerId":"geoip","msg":"Initiating GeoIP..."}',
      '{"level":"debug","time":"2026-05-08T15:58:10.408Z","childLoggerId":"asn-geoip","msg":"Initiating GeoIP..."}',
      '{"level":"debug","time":"2026-05-08T15:58:10.768Z","childLoggerId":"flipt","msg":"Setting up flipt..."}',
      '{"level":30,"time":"2026-05-08T15:58:10.776Z","name":"liveness","uptime":"2s","msg":"All services are up and running"}',
    ].join("\n")}\n`;
    const lines = await LogFormatterHelper.format(input);
    assert.deepEqual(lines, [
      `[${LogFormatterHelper.formatTime("2026-05-08T15:58:09.007Z")}] INFO (liveness) [0s]: Running liveness checks...`,
      `[${LogFormatterHelper.formatTime("2026-05-08T15:58:10.408Z")}] DEBUG: Initiating GeoIP... childLoggerId=geoip`,
      `[${LogFormatterHelper.formatTime("2026-05-08T15:58:10.408Z")}] DEBUG: Initiating GeoIP... childLoggerId=asn-geoip`,
      `[${LogFormatterHelper.formatTime("2026-05-08T15:58:10.768Z")}] DEBUG: Setting up flipt... childLoggerId=flipt`,
      ` UP  [${LogFormatterHelper.formatTime("2026-05-08T15:58:10.776Z")}] INFO (liveness) [2s]: All services are up and running`,
    ]);
  });
});
