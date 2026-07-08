import { describe, it } from "node:test";
import { UntTestHelper } from "./unt-helper.ts";
import { strict as assert } from "node:assert";

describe("unt", { concurrency: true }, () => {
  it("polls until grep matches, then prints the verification command and exits 0", async () => {
    const helper = UntTestHelper;
    const { flagFile } = await helper.createWorkspace();
    const flagWritten = helper.scheduleFlagWrite({
      content: "READY-NOW\n",
      delayMs: 600,
      flagFile,
    });

    const { stdout, exitCode } = await helper.runUnt([
      "--command",
      `cat ${flagFile} 2>&1 || true`,
      "--grep-args",
      "READY-NOW",
      "--interval-ms",
      "150",
      "--timeout-ms",
      "5000",
    ]);
    await flagWritten;

    assert.equal(exitCode, 0);
    const { logPath, grepArgs } = helper.parseVerificationCommand(stdout);
    assert.equal(grepArgs, "READY-NOW");

    const logContent = await helper.readLogFile(logPath);
    assert.match(logContent, /READY-NOW/u);
  });

  it("matches on first tick when the command already produces the target", async () => {
    const helper = UntTestHelper;
    const startedAt = Date.now();
    const { stdout, exitCode } = await helper.runUnt([
      "--command",
      "echo immediate-hit",
      "--grep-args",
      "immediate-hit",
      "--interval-ms",
      "5000",
      "--timeout-ms",
      "60000",
    ]);
    const elapsedMs = Date.now() - startedAt;

    assert.equal(exitCode, 0);
    assert.ok(
      elapsedMs < 2000,
      `first-tick match must not wait a full interval (took ${elapsedMs}ms)`,
    );
    const { grepArgs } = helper.parseVerificationCommand(stdout);
    assert.equal(grepArgs, "immediate-hit");
  });

  it("exits 1 with a timeout error when no command ever matches", async () => {
    const helper = UntTestHelper;
    const { stderr, exitCode } = await helper.runUntAllowFailure([
      "--command",
      "echo nothing-here",
      "--grep-args",
      "never-going-to-match-xyz",
      "--interval-ms",
      "100",
      "--timeout-ms",
      "400",
    ]);
    assert.equal(exitCode, 1);
    assert.match(stderr, /timeout after 400ms/u);
  });

  it("first matching command wins immediately; slow siblings do not delay exit", async () => {
    const helper = UntTestHelper;
    const startedAt = Date.now();
    const { stdout, exitCode } = await helper.runUnt([
      "--command",
      "sleep 10 && echo slow-loser",
      "--grep-args",
      "slow-loser",
      "--command",
      "echo fast-winner",
      "--grep-args",
      "fast-winner",
      "--interval-ms",
      "500",
      "--timeout-ms",
      "30000",
    ]);
    const elapsedMs = Date.now() - startedAt;

    assert.equal(exitCode, 0);
    assert.ok(
      elapsedMs < 3000,
      `race winner should not wait for sibling 'sleep 10' (took ${elapsedMs}ms)`,
    );
    const { grepArgs } = helper.parseVerificationCommand(stdout);
    assert.equal(grepArgs, "fast-winner");
  });

  it("uses content-addressed log files: different pairs produce different paths", async () => {
    const helper = UntTestHelper;
    const first = await helper.runUnt([
      "--command",
      "echo alpha",
      "--grep-args",
      "alpha",
      "--interval-ms",
      "100",
      "--timeout-ms",
      "3000",
    ]);
    const second = await helper.runUnt([
      "--command",
      "echo bravo",
      "--grep-args",
      "bravo",
      "--interval-ms",
      "100",
      "--timeout-ms",
      "3000",
    ]);

    const firstParsed = helper.parseVerificationCommand(first.stdout);
    const secondParsed = helper.parseVerificationCommand(second.stdout);
    assert.notEqual(firstParsed.logPath, secondParsed.logPath);
  });

  it("uses content-addressed log files: identical pairs reuse the same path", async () => {
    const helper = UntTestHelper;
    const first = await helper.runUnt([
      "--command",
      "echo same-input",
      "--grep-args",
      "same-input",
      "--interval-ms",
      "100",
      "--timeout-ms",
      "3000",
    ]);
    const second = await helper.runUnt([
      "--command",
      "echo same-input",
      "--grep-args",
      "same-input",
      "--interval-ms",
      "100",
      "--timeout-ms",
      "3000",
    ]);

    const firstParsed = helper.parseVerificationCommand(first.stdout);
    const secondParsed = helper.parseVerificationCommand(second.stdout);
    assert.equal(firstParsed.logPath, secondParsed.logPath);
  });

  it("accepts --grep-args whose value starts with a dash (e.g. '-E pattern')", async () => {
    const helper = UntTestHelper;
    const { stdout, exitCode } = await helper.runUnt([
      "--command",
      "echo ERROR: something failed",
      "--grep-args",
      '-E "ERROR|FAIL"',
      "--interval-ms",
      "200",
      "--timeout-ms",
      "3000",
    ]);
    assert.equal(exitCode, 0);
    const { grepArgs } = helper.parseVerificationCommand(stdout);
    assert.equal(grepArgs, '-E "ERROR|FAIL"');
  });

  it("rejects mismatched --command and --grep-args counts", async () => {
    const helper = UntTestHelper;
    const { stderr, exitCode } = await helper.runUntAllowFailure([
      "--command",
      "echo a",
      "--command",
      "echo b",
      "--grep-args",
      "a",
      "--interval-ms",
      "100",
      "--timeout-ms",
      "1000",
    ]);
    assert.equal(exitCode, 1);
    assert.match(stderr, /--command count must match --grep-args count/u);
  });

  it("rejects invocations missing required options (e.g. no --timeout-ms)", async () => {
    const helper = UntTestHelper;
    const { exitCode } = await helper.runUntAllowFailure([
      "--command",
      "echo a",
      "--grep-args",
      "a",
      "--interval-ms",
      "100",
    ]);
    assert.equal(exitCode, 1);
  });

  it("--help prints usage and exits 0 without running any command", async () => {
    const helper = UntTestHelper;
    const { stdout, exitCode } = await helper.runUnt(["--help"]);
    assert.equal(exitCode, 0);
    assert.match(stdout, /USAGE:/u);
    assert.match(stdout, /--interval-ms/u);
    assert.match(stdout, /--timeout-ms/u);
  });

  it("running with no args also prints help and exits 0", async () => {
    const helper = UntTestHelper;
    const { stdout, exitCode } = await helper.runUnt([]);
    assert.equal(exitCode, 0);
    assert.match(stdout, /USAGE:/u);
  });

  it("captures stderr from the polled command so grep can match it", async () => {
    const helper = UntTestHelper;
    const { stdout, exitCode } = await helper.runUnt([
      "--command",
      "echo on-stderr 1>&2",
      "--grep-args",
      "on-stderr",
      "--interval-ms",
      "200",
      "--timeout-ms",
      "3000",
    ]);
    assert.equal(exitCode, 0);
    const { logPath } = helper.parseVerificationCommand(stdout);
    const logContent = await helper.readLogFile(logPath);
    assert.match(logContent, /on-stderr/u);
  });

  it("captures output even when the polled command exits non-zero", async () => {
    const helper = UntTestHelper;
    const { stdout, exitCode } = await helper.runUnt([
      "--command",
      "echo before-failure; exit 7",
      "--grep-args",
      "before-failure",
      "--interval-ms",
      "200",
      "--timeout-ms",
      "3000",
    ]);
    assert.equal(exitCode, 0);
    const { logPath } = helper.parseVerificationCommand(stdout);
    const logContent = await helper.readLogFile(logPath);
    assert.match(logContent, /before-failure/u);
  });

  it("complex: case-insensitive -i + quoted BRE regex matches mixed-case output", async () => {
    const helper = UntTestHelper;
    const { stdout, exitCode } = await helper.runUnt([
      "--command",
      "echo 'API listening on 0.0.0.0:8080 (READY)'",
      "--grep-args",
      "-i 'lis.*ing'",
      "--interval-ms",
      "200",
      "--timeout-ms",
      "3000",
    ]);
    assert.equal(exitCode, 0);
    const { grepArgs } = helper.parseVerificationCommand(stdout);
    assert.equal(grepArgs, "-i 'lis.*ing'");
  });

  it("complex: -iE alternation matches case-insensitively across alternatives", async () => {
    const helper = UntTestHelper;
    const { stdout, exitCode } = await helper.runUnt([
      "--command",
      "echo 'API listening on 0.0.0.0:8080 (READY)'",
      "--grep-args",
      "-iE '(ready|listening on)'",
      "--interval-ms",
      "200",
      "--timeout-ms",
      "3000",
    ]);
    assert.equal(exitCode, 0);
    const { grepArgs } = helper.parseVerificationCommand(stdout);
    assert.equal(grepArgs, "-iE '(ready|listening on)'");
  });

  it("complex: rollout watcher — three racing checks (success phase + fatal log + waiting-reason), success branch wins", async () => {
    const helper = UntTestHelper;
    const { workDir } = await helper.createWorkspace();
    const phaseFile = `${workDir}/phase`;
    const logsFile = `${workDir}/logs`;
    const waitingFile = `${workDir}/waiting`;

    const setPhaseRunningSoon = helper.scheduleFlagWrite({
      content: "Running\n",
      delayMs: 500,
      flagFile: phaseFile,
    });

    const { stdout, exitCode } = await helper.runUnt([
      "--command",
      `cat ${phaseFile} 2>/dev/null || true`,
      "--grep-args",
      String.raw`-iE '\<running\>'`,
      "--command",
      `cat ${logsFile} 2>/dev/null || true`,
      "--grep-args",
      "-iE '(panic|fatal|oomkilled|segfault)'",
      "--command",
      `cat ${waitingFile} 2>/dev/null || true`,
      "--grep-args",
      "-iE '(crashloopbackoff|imagepullbackoff|errimagepull)'",
      "--interval-ms",
      "150",
      "--timeout-ms",
      "5000",
    ]);
    await setPhaseRunningSoon;

    assert.equal(exitCode, 0);
    const { logPath, grepArgs } = helper.parseVerificationCommand(stdout);
    assert.equal(grepArgs, String.raw`-iE '\<running\>'`, "success branch must be the winner");
    const logContent = await helper.readLogFile(logPath);
    assert.match(logContent, /Running/u);
  });

  it("log layout: first line is the command, then a blank line, then the output", async () => {
    const helper = UntTestHelper;
    const command = "echo ok";
    const { stdout, exitCode } = await helper.runUnt([
      "--command",
      command,
      "--grep-args",
      "ok",
      "--interval-ms",
      "100",
      "--timeout-ms",
      "1000",
    ]);
    assert.equal(exitCode, 0);
    const { logPath } = helper.parseVerificationCommand(stdout);
    const content = await helper.readLogFile(logPath);
    const lines = content.split("\n");
    // Expected: ["echo ok", "", "ok", ""]  (trailing "" from final EOL)
    assert.equal(lines[0], command, "first line must be the command");
    assert.equal(lines[1], "", "second line must be blank");
    assert.equal(lines[2], "ok", "third line must be the command output");
  });

  it("log layout: ends with exactly one trailing newline (no extra blank line)", async () => {
    const helper = UntTestHelper;
    const { stdout, exitCode } = await helper.runUnt([
      "--command",
      "echo ok",
      "--grep-args",
      "ok",
      "--interval-ms",
      "100",
      "--timeout-ms",
      "1000",
    ]);
    assert.equal(exitCode, 0);
    const { logPath } = helper.parseVerificationCommand(stdout);
    const content = await helper.readLogFile(logPath);
    assert.ok(
      content.endsWith("\n") && !content.endsWith("\n\n"),
      `log must end with exactly one trailing newline; got: ${JSON.stringify(content.slice(-4))}`,
    );
  });

  it("log layout: multiline command output is preserved and blank-line-separated from the command", async () => {
    const helper = UntTestHelper;
    const command = String.raw`printf 'line1\nline2\nline3\n'`;
    const { stdout, exitCode } = await helper.runUnt([
      "--command",
      command,
      "--grep-args",
      "line2",
      "--interval-ms",
      "100",
      "--timeout-ms",
      "1000",
    ]);
    assert.equal(exitCode, 0);
    const { logPath } = helper.parseVerificationCommand(stdout);
    const content = await helper.readLogFile(logPath);
    const lines = content.split("\n");
    assert.equal(lines[0], command, "first line is the command");
    assert.equal(lines[1], "", "blank separator line");
    assert.equal(lines[2], "line1");
    assert.equal(lines[3], "line2");
    assert.equal(lines[4], "line3");
  });

  it("--help lists the smoke-test example so users can verify the tool is wired up", async () => {
    const helper = UntTestHelper;
    const { stdout, exitCode } = await helper.runUnt(["--help"]);
    assert.equal(exitCode, 0);
    assert.match(stdout, /EXAMPLES:/u);
    assert.match(stdout, /Smoke-test/u);
    assert.match(stdout, /echo ok/u);
  });

  it("does not false-match when the grep pattern appears in the command text but not in the output", async () => {
    const helper = UntTestHelper;
    const { stderr, exitCode } = await helper.runUntAllowFailure([
      "--command",
      "echo MARKER_IN_CMD >/dev/null; echo only-output",
      "--grep-args",
      "MARKER_IN_CMD",
      "--interval-ms",
      "100",
      "--timeout-ms",
      "500",
    ]);
    assert.equal(exitCode, 1);
    assert.match(stderr, /timeout after 500ms/u);
  });

  it("complex: rollout watcher — fail-fast branch wins when CrashLoopBackOff appears before success", async () => {
    const helper = UntTestHelper;
    const { workDir } = await helper.createWorkspace();
    const phaseFile = `${workDir}/phase`;
    const logsFile = `${workDir}/logs`;
    const waitingFile = `${workDir}/waiting`;

    const setWaitingCrashSoon = helper.scheduleFlagWrite({
      content: "CrashLoopBackOff\n",
      delayMs: 300,
      flagFile: waitingFile,
    });

    const { stdout, exitCode } = await helper.runUnt([
      "--command",
      `cat ${phaseFile} 2>/dev/null || true`,
      "--grep-args",
      String.raw`-iE '\<running\>'`,
      "--command",
      `cat ${logsFile} 2>/dev/null || true`,
      "--grep-args",
      "-iE '(panic|fatal|oomkilled)'",
      "--command",
      `cat ${waitingFile} 2>/dev/null || true`,
      "--grep-args",
      "-iE '(crashloopbackoff|imagepullbackoff)'",
      "--interval-ms",
      "100",
      "--timeout-ms",
      "5000",
    ]);
    await setWaitingCrashSoon;

    assert.equal(exitCode, 0);
    const { logPath, grepArgs } = helper.parseVerificationCommand(stdout);
    assert.equal(
      grepArgs,
      "-iE '(crashloopbackoff|imagepullbackoff)'",
      "waiting-reason branch must be the winner",
    );
    const logContent = await helper.readLogFile(logPath);
    assert.match(logContent, /CrashLoopBackOff/u);
  });
});
