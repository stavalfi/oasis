import { describe, it } from "node:test";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { strict as assert } from "node:assert";

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const OXLINT = path.resolve(ROOT, "node_modules/.bin/oxlint");
const CONFIG = path.resolve(import.meta.dirname, ".oxlintrc.json");
const FIXTURES = path.resolve(import.meta.dirname, "fixtures");

interface LintResult {
  readonly exitCode: number;
  readonly stdout: string;
}

const runLintWithConfig = async ({
  fixturePath,
  config,
}: {
  readonly fixturePath: string;
  readonly config: string;
}): Promise<LintResult> => {
  try {
    const { stdout } = await execFileAsync(OXLINT, ["--config", config, fixturePath], {
      cwd: ROOT,
    });
    return { exitCode: 0, stdout };
  } catch (err) {
    const e = err as { stdout?: string; code?: number | string; stderr?: string };
    if (typeof e.code !== "number") {
      throw new Error(`oxlint spawn failed (${String(e.code)}): ${e.stderr ?? ""}`);
    }
    return { exitCode: e.code, stdout: e.stdout ?? "" };
  }
};

const runLint = async (fixturePath: string): Promise<LintResult> =>
  runLintWithConfig({ fixturePath, config: CONFIG });

const violationsFor = ({
  stdout,
  rule,
}: {
  readonly stdout: string;
  readonly rule: string;
}): string[] => stdout.split("\n").filter((line) => line.includes(`poc-rules(${rule})`));

const fixture = (name: string): string => path.join(FIXTURES, name);

describe("poc-rules lint plugin", { concurrency: true }, () => {
  describe("no-anonymous-functions", () => {
    it("reports immediately-invoked arrow and function expressions", async () => {
      const { exitCode, stdout } = await runLint(fixture("no-anonymous-functions.invalid.ts"));
      assert.notEqual(exitCode, 0);
      const violations = violationsFor({ stdout, rule: "no-anonymous-functions" });
      assert.equal(violations.length, 2);
    });

    it("passes for named functions", async () => {
      const { exitCode } = await runLint(fixture("no-anonymous-functions.valid.ts"));
      assert.equal(exitCode, 0);
    });
  });

  describe("no-banned-words", () => {
    it("reports string literals containing banned words", async () => {
      const { exitCode, stdout } = await runLint(fixture("no-banned-words.invalid.ts"));
      assert.notEqual(exitCode, 0);
      const violations = violationsFor({ stdout, rule: "no-banned-words" });
      assert.equal(violations.length, 2);
    });

    it("passes when no banned words are present", async () => {
      const { exitCode } = await runLint(fixture("no-banned-words.valid.ts"));
      assert.equal(exitCode, 0);
    });
  });

  describe("no-curl", () => {
    it("reports execFileAsync calls with curl and wget", async () => {
      const { exitCode, stdout } = await runLint(fixture("no-curl.invalid.ts"));
      assert.notEqual(exitCode, 0);
      const violations = violationsFor({ stdout, rule: "no-curl" });
      assert.equal(violations.length, 2);
    });

    it("passes for allowed commands", async () => {
      const { exitCode } = await runLint(fixture("no-curl.valid.ts"));
      assert.equal(exitCode, 0);
    });
  });

  describe("no-custom-resource", () => {
    it("reports new CustomResource from @pulumi/kubernetes/apiextensions", async () => {
      const { exitCode, stdout } = await runLint(fixture("no-custom-resource.invalid.ts"));
      assert.notEqual(exitCode, 0);
      const violations = violationsFor({ stdout, rule: "no-custom-resource" });
      assert.equal(violations.length, 1);
    });

    it("passes when CustomResource is not used", async () => {
      const { exitCode } = await runLint(fixture("no-custom-resource.valid.ts"));
      assert.equal(exitCode, 0);
    });
  });

  describe("no-private-keyword", () => {
    it("reports private fields and methods", async () => {
      const { exitCode, stdout } = await runLint(fixture("no-private-keyword.invalid.ts"));
      assert.notEqual(exitCode, 0);
      const violations = violationsFor({ stdout, rule: "no-private-keyword" });
      assert.equal(violations.length, 2);
    });

    it("passes for # fields, # methods, and private constructors", async () => {
      const { exitCode } = await runLint(fixture("no-private-keyword.valid.ts"));
      assert.equal(exitCode, 0);
    });
  });

  describe("no-process-stream-write", () => {
    it("reports process.stdout.write and process.stderr.write", async () => {
      const { exitCode, stdout } = await runLint(fixture("no-process-stream-write.invalid.ts"));
      assert.notEqual(exitCode, 0);
      const violations = violationsFor({ stdout, rule: "no-process-stream-write" });
      assert.equal(violations.length, 2);
    });

    it("passes for console.log and console.error", async () => {
      const { exitCode } = await runLint(fixture("no-process-stream-write.valid.ts"));
      assert.equal(exitCode, 0);
    });
  });

  describe("no-protected", () => {
    it("reports protected fields and methods", async () => {
      const { exitCode, stdout } = await runLint(fixture("no-protected.invalid.ts"));
      assert.notEqual(exitCode, 0);
      const violations = violationsFor({ stdout, rule: "no-protected" });
      assert.equal(violations.length, 2);
    });

    it("passes for private and public members", async () => {
      const { exitCode } = await runLint(fixture("no-protected.valid.ts"));
      assert.equal(exitCode, 0);
    });
  });

  describe("no-zod-passthrough", () => {
    it("reports .passthrough() calls", async () => {
      const { exitCode, stdout } = await runLint(fixture("no-zod-passthrough.invalid.ts"));
      assert.notEqual(exitCode, 0);
      const violations = violationsFor({ stdout, rule: "no-zod-passthrough" });
      assert.equal(violations.length, 1);
    });

    it("passes for .loose() and z.looseObject()", async () => {
      const { exitCode } = await runLint(fixture("no-zod-passthrough.valid.ts"));
      assert.equal(exitCode, 0);
    });
  });

  describe("require-access-modifiers", () => {
    it("reports class members without explicit public or private", async () => {
      const { exitCode, stdout } = await runLint(fixture("require-access-modifiers.invalid.ts"));
      assert.notEqual(exitCode, 0);
      const violations = violationsFor({ stdout, rule: "require-access-modifiers" });
      assert.ok(violations.length >= 4, `expected >=4 violations, got ${violations.length}`);
    });

    it("passes when all members have explicit modifiers or use # private fields", async () => {
      const { exitCode } = await runLint(fixture("require-access-modifiers.valid.ts"));
      assert.equal(exitCode, 0);
    });
  });

  describe("require-object-params", () => {
    it("reports constructors and methods with more than 1 parameter", async () => {
      const { exitCode, stdout } = await runLint(fixture("require-object-params.invalid.ts"));
      assert.notEqual(exitCode, 0);
      const violations = violationsFor({ stdout, rule: "require-object-params" });
      assert.equal(violations.length, 5);
    });

    it("reports function declarations with more than 1 parameter", async () => {
      const { exitCode, stdout } = await runLint(fixture("require-object-params.invalid.ts"));
      assert.notEqual(exitCode, 0);
      const violations = violationsFor({ stdout, rule: "require-object-params" });
      assert.ok(
        violations.some((v) => v.includes("namedFn")),
        `expected namedFn violation in:\n${violations.join("\n")}`,
      );
    });

    it("reports arrow functions assigned to const with more than 1 parameter", async () => {
      const { exitCode, stdout } = await runLint(fixture("require-object-params.invalid.ts"));
      assert.notEqual(exitCode, 0);
      const violations = violationsFor({ stdout, rule: "require-object-params" });
      assert.ok(
        violations.some((v) => v.includes("arrowFn")),
        `expected arrowFn violation in:\n${violations.join("\n")}`,
      );
    });

    it("passes for single-param methods, no-param methods, getters, setters, and inline callbacks", async () => {
      const { exitCode } = await runLint(fixture("require-object-params.valid.ts"));
      assert.equal(exitCode, 0);
    });

    it("reports single-field object params that should be plain positional params", async () => {
      const { exitCode, stdout } = await runLint(
        fixture("require-object-params.single-field.invalid.ts"),
      );
      assert.notEqual(exitCode, 0);
      const violations = violationsFor({ stdout, rule: "require-object-params" });
      assert.equal(violations.length, 4);
      assert.ok(
        violations.every((v) => v.includes("single-field object parameter")),
        `expected single-field messages in:\n${violations.join("\n")}`,
      );
    });
  });

  describe("no-global-functions", () => {
    const noGlobalFnsConfig = path.resolve(
      import.meta.dirname,
      "no-global-functions.oxlintrc.json",
    );

    it("reports global function declarations, arrow functions, and function expressions", async () => {
      const { exitCode, stdout } = await runLintWithConfig({
        fixturePath: fixture("no-global-functions.invalid.ts"),
        config: noGlobalFnsConfig,
      });
      assert.notEqual(exitCode, 0);
      const violations = violationsFor({ stdout, rule: "no-global-functions" });
      assert.equal(violations.length, 3);
    });

    it("passes for classes with static methods and non-function module-level code", async () => {
      const { exitCode } = await runLintWithConfig({
        fixturePath: fixture("no-global-functions.valid.ts"),
        config: noGlobalFnsConfig,
      });
      assert.equal(exitCode, 0);
    });
  });

  describe("no-pulumi-in-libs", () => {
    const pulumiConfig = path.resolve(import.meta.dirname, "no-pulumi-in-libs.oxlintrc.json");

    it("reports @pulumi/* imports", async () => {
      const { exitCode, stdout } = await runLintWithConfig({
        fixturePath: fixture("no-pulumi-in-libs.invalid.ts"),
        config: pulumiConfig,
      });
      assert.notEqual(exitCode, 0);
      const violations = stdout
        .split("\n")
        .filter((line) => line.includes("no-restricted-imports"));
      assert.equal(violations.length, 2);
    });

    it("passes for non-pulumi imports", async () => {
      const { exitCode } = await runLintWithConfig({
        fixturePath: fixture("no-pulumi-in-libs.valid.ts"),
        config: pulumiConfig,
      });
      assert.equal(exitCode, 0);
    });
  });
});
