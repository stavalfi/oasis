import { strict as assert } from "node:assert";
import { exec } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const HOOK = path.resolve(import.meta.dirname, "../src/shell-audit/command-generation.ts");

interface HookInput {
  tool_input: { command: string };
  tool_name: string;
}
interface HookOutput {
  hookSpecificOutput: { hookEventName: "PreToolUse"; updatedInput: { command: string } };
}

class HookRunner {
  static async #exec({
    command,
    withDebugger,
  }: {
    command: string;
    withDebugger: boolean;
  }): Promise<HookOutput> {
    const input: HookInput = { tool_input: { command }, tool_name: "Bash" };
    const baseEnv: NodeJS.ProcessEnv = { ...process.env, HOOK_INPUT: JSON.stringify(input) };
    if (withDebugger) {
      baseEnv["CLAUDE_SHELL_DEBUGGER"] = "1";
    } else {
      delete baseEnv["CLAUDE_SHELL_DEBUGGER"];
    }
    const { stdout } = await execAsync(`printf '%s' "$HOOK_INPUT" | node ${HOOK}`, {
      env: baseEnv,
      shell: "/bin/sh",
    });
    return JSON.parse(stdout.toString());
  }

  public static run(command: string): Promise<HookOutput> {
    return HookRunner.#exec({ command, withDebugger: false });
  }

  public static runWithDebugger(command: string): Promise<HookOutput> {
    return HookRunner.#exec({ command, withDebugger: true });
  }
}

describe("command-rewriter", { concurrency: true }, () => {
  it("ls: adds rtk prefix", async () => {
    const out = await HookRunner.run("ls -la");
    assert.equal(out.hookSpecificOutput.updatedInput.command, "rtk ls -la");
  });

  it("git: adds rtk prefix", async () => {
    const out = await HookRunner.run("git log --oneline -10");
    assert.equal(out.hookSpecificOutput.updatedInput.command, "rtk git log --oneline -10");
  });

  it("gh: adds rtk prefix", async () => {
    const out = await HookRunner.run("gh pr list");
    assert.equal(out.hookSpecificOutput.updatedInput.command, "rtk gh pr list");
  });

  it("docker: adds rtk prefix", async () => {
    const out = await HookRunner.run("docker ps");
    assert.equal(out.hookSpecificOutput.updatedInput.command, "rtk docker ps");
  });

  it("kubectl: adds rtk prefix", async () => {
    const out = await HookRunner.run("kubectl get pods -n default");
    assert.equal(out.hookSpecificOutput.updatedInput.command, "rtk kubectl get pods -n default");
  });

  it("curl: adds rtk prefix", async () => {
    const out = await HookRunner.run("curl -s http://example.com");
    assert.equal(out.hookSpecificOutput.updatedInput.command, "rtk curl -s http://example.com");
  });

  it("grep: adds rtk prefix", async () => {
    const out = await HookRunner.run("grep -r foo .");
    assert.equal(out.hookSpecificOutput.updatedInput.command, "rtk grep -r foo .");
  });

  it("find: passes through unchanged", async () => {
    const out = await HookRunner.run("find . -name '*.ts'");
    assert.equal(out.hookSpecificOutput.updatedInput.command, "find . -name '*.ts'");
  });

  it("rtk find: compresses output to summary, losing individual file paths", async () => {
    // Reproduces the bug: rtk collapses find results into a token-saving summary
    // like "\n\n6F 2D:\n./foo.ts ..." instead of listing every path.
    // This makes find unreliable for code exploration, so it must not go through rtk.
    const dir = "/home/stav/projects/poc/devex/scripts";
    const { stdout: rtkOut } = await execAsync(`rtk find ${dir} -type f`);
    const { stdout: rawOut } = await execAsync(`find ${dir} -type f`);
    const rtkLines = rtkOut.trim().split("\n").filter(Boolean).length;
    const rawLines = rawOut.trim().split("\n").filter(Boolean).length;
    assert.ok(
      rtkLines < rawLines,
      `expected rtk to compress (rtk: ${rtkLines} lines, raw: ${rawLines} lines)\nrtk output:\n${rtkOut.slice(0, 400)}`,
    );
  });

  it("diff: adds rtk prefix", async () => {
    const out = await HookRunner.run("diff file1 file2");
    assert.equal(out.hookSpecificOutput.updatedInput.command, "rtk diff file1 file2");
  });

  it("bare git: adds rtk prefix", async () => {
    const out = await HookRunner.run("git");
    assert.equal(out.hookSpecificOutput.updatedInput.command, "rtk git");
  });

  it("echo: passes through unchanged", async () => {
    const out = await HookRunner.run("echo hello");
    assert.equal(out.hookSpecificOutput.updatedInput.command, "echo hello");
  });

  it("node: passes through unchanged", async () => {
    const out = await HookRunner.run("node foo.ts");
    assert.equal(out.hookSpecificOutput.updatedInput.command, "node foo.ts");
  });

  it("bun: passes through unchanged", async () => {
    const out = await HookRunner.run("npm run lint");
    assert.equal(out.hookSpecificOutput.updatedInput.command, "npm run lint");
  });

  it("already-rtk-prefixed: passes through unchanged", async () => {
    const out = await HookRunner.run("rtk git status");
    assert.equal(out.hookSpecificOutput.updatedInput.command, "rtk git status");
  });

  it("absolute path: passes through unchanged", async () => {
    const out = await HookRunner.run("/usr/bin/git status");
    assert.equal(out.hookSpecificOutput.updatedInput.command, "/usr/bin/git status");
  });

  it("relative path: passes through unchanged", async () => {
    const out = await HookRunner.run("./script.sh");
    assert.equal(out.hookSpecificOutput.updatedInput.command, "./script.sh");
  });

  it("compound &&: rewrites all matching CLIs", async () => {
    const out = await HookRunner.run("git status && ls -la");
    assert.equal(out.hookSpecificOutput.updatedInput.command, "rtk git status && rtk ls -la");
  });

  it("compound &&: skips unknown segments, rewrites known ones", async () => {
    const out = await HookRunner.run("echo hello && git status");
    assert.equal(out.hookSpecificOutput.updatedInput.command, "echo hello && rtk git status");
  });

  it("compound ;: rewrites each known CLI segment", async () => {
    const out = await HookRunner.run("git fetch; git pull");
    assert.equal(out.hookSpecificOutput.updatedInput.command, "rtk git fetch; rtk git pull");
  });

  it("pipe |: rewrites each known CLI segment", async () => {
    const out = await HookRunner.run("git log --oneline | grep fix");
    assert.equal(
      out.hookSpecificOutput.updatedInput.command,
      "rtk git log --oneline | rtk grep fix",
    );
  });

  it("compound mixed: only rewrites known CLIs across operators", async () => {
    const out = await HookRunner.run("cd /tmp && git status && echo done");
    assert.equal(
      out.hookSpecificOutput.updatedInput.command,
      "cd /tmp && rtk git status && echo done",
    );
  });

  it("command-runner: stdout is raw text, not Buffer representation", async () => {
    // Reproduces the bug: command-runner.ts does console.log(chunk) where chunk
    // is a Buffer, which Node prints as "<Buffer 68 65 6c 6c 6f ...>" instead of
    // the actual command output.
    const out = await HookRunner.runWithDebugger("printf hello");
    const { command } = out.hookSpecificOutput.updatedInput;
    const { stdout } = await execAsync(command);
    assert.ok(
      !stdout.includes("<Buffer "),
      `expected plain text but got Buffer representation:\n${stdout}`,
    );
    assert.ok(stdout.includes("hello"), `expected "hello" in output but got:\n${stdout}`);
  });
});
