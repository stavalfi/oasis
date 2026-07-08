import { type HookInput, type HookOutput } from "../src/shell-audit/command-generation.ts";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execAsync = promisify(exec);

const HOOK = path.resolve(import.meta.dirname, "../src/shell-audit/command-generation.ts");

class ShellAuditHookRunner {
  public static async run(
    command: string,
  ): Promise<{ stdout: string; stderr: string; uuid: string; logContent: string }> {
    const uuid = randomUUID();
    const logDir = `/tmp/sweet-test/${uuid}`;
    await fs.mkdir(logDir, { recursive: true });
    const input: HookInput = { tool_input: { command }, tool_name: "Bash" };
    const hookResult = await execAsync(`printf '%s' "$HOOK_INPUT" | node ${HOOK}`, {
      env: {
        ...process.env,
        CLAUDE_SHELL_DEBUGGER: "true",
        CLAUDE_SHELL_OUTPUT_DIR: logDir,
        CLAUDE_SHELL_OUTPUT_UUID: uuid,
        HOOK_INPUT: JSON.stringify(input),
      },
      shell: "/bin/sh",
    });
    const out: HookOutput = JSON.parse(hookResult.stdout.toString());
    const { stdout, stderr } = await execAsync(out.hookSpecificOutput.updatedInput.command, {
      env: { ...process.env, CLAUDE_SHELL_OUTPUT_DIR: logDir, CLAUDE_SHELL_OUTPUT_UUID: uuid },
      shell: "/bin/sh",
    });
    const logFiles = await fs.readdir(logDir);
    const logFile = logFiles.find((file) => file.endsWith(".log"));
    if (!logFile) {
      throw new Error(`no .log file found in ${logDir}`);
    }
    const logContent = await fs.readFile(path.join(logDir, logFile), "utf8");
    return { logContent, stderr, stdout, uuid };
  }
}

describe("shell-audit", { concurrency: true }, () => {
  it("wrapped echo writes 'hello' to stdout (with known UUID + custom log dir)", async () => {
    const { logContent, stdout, stderr, uuid } = await ShellAuditHookRunner.run("echo hello");
    assert.match(logContent, /hello/u);
    assert.match(stdout, /hello/u);
    assert.doesNotMatch(stderr, /hello/u);
    assert.ok(logContent.startsWith("---------------------\n"));
    assert.match(logContent, new RegExp(`^start-uuid="${uuid}"$`, "mu"));
    assert.match(logContent, /^command: "echo hello"$/mu);
    assert.match(logContent, /^timestamp: "\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}"$/mu);
    assert.match(logContent, /^output:$/mu);
    assert.match(logContent, /^hello$/mu);
    assert.match(logContent, /^duration: \d+\.\d{3}s$/mu);
    assert.match(
      logContent,
      new RegExp(
        `^proof: sed -n "/\\^start-uuid=\\\\"${uuid}\\\\"\\$/,/\\^end-uuid=\\\\"${uuid}\\\\"\\$/p" /tmp/sweet-test/${uuid}/\\d{4}-\\d{2}-\\d{2}\\.log$`,
        "mu",
      ),
    );
    assert.match(logContent, new RegExp(`^end-uuid="${uuid}"$`, "mu"));
    const startIdx = logContent.indexOf(`start-uuid="${uuid}"`);
    const helloIdx = logContent.indexOf("\nhello\n");
    const endIdx = logContent.indexOf(`end-uuid="${uuid}"`);
    assert.ok(
      startIdx !== -1 && helloIdx > startIdx && endIdx > helloIdx,
      "order: start-uuid -> hello -> end-uuid",
    );
  });

  it("stderr-only command lands in stderr, not stdout", async () => {
    const { stdout, stderr } = await ShellAuditHookRunner.run("echo err-only >&2");
    assert.match(stderr, /err-only/u);
    assert.doesNotMatch(stdout, /err-only/u);
  });

  it("mixed streams stay separated", async () => {
    const { stdout, stderr } = await ShellAuditHookRunner.run("echo OUT; echo ERR >&2");
    assert.match(stdout, /OUT/u);
    assert.match(stderr, /ERR/u);
    assert.doesNotMatch(stdout, /ERR/u);
    assert.doesNotMatch(stderr, /OUT/u);
  });

  it("explicit 1>&2 sends stdout to stderr", async () => {
    const { stdout, stderr } = await ShellAuditHookRunner.run("echo to-err 1>&2");
    assert.match(stderr, /to-err/u);
    assert.doesNotMatch(stdout, /to-err/u);
  });

  it("inline 2>&1 merges stderr into stdout", async () => {
    const { stdout, stderr } = await ShellAuditHookRunner.run("{ echo A; echo B >&2; } 2>&1");
    assert.match(stdout, /A/u);
    assert.match(stdout, /B/u);
    assert.doesNotMatch(stderr, /^A$/mu);
    assert.doesNotMatch(stderr, /^B$/mu);
  });

  it("pipe to tr uppercases", async () => {
    const { stdout } = await ShellAuditHookRunner.run("echo hello | tr a-z A-Z");
    assert.match(stdout, /HELLO/u);
  });

  it("two-stage pipe (tr + rev)", async () => {
    const { stdout } = await ShellAuditHookRunner.run("echo abc | tr a-z A-Z | rev");
    assert.match(stdout, /CBA/u);
  });

  it("three-stage pipe (seq + grep + wc)", async () => {
    const { stdout } = await ShellAuditHookRunner.run("seq 1 20 | grep '^1' | wc -l");
    assert.match(stdout, /^11$/mu);
  });

  it("command substitution $(...)", async () => {
    const { stdout } = await ShellAuditHookRunner.run("echo result=$(echo nested)");
    assert.match(stdout, /result=nested/u);
  });

  it("nested command substitution", async () => {
    const { stdout } = await ShellAuditHookRunner.run("echo a-$(echo b-$(echo c))");
    assert.match(stdout, /a-b-c/u);
  });

  it("variable assignment and use", async () => {
    const { stdout } = await ShellAuditHookRunner.run("X=42; Y=8; echo total=$((X+Y))");
    assert.match(stdout, /total=50/u);
  });

  it("arithmetic expansion", async () => {
    const { stdout } = await ShellAuditHookRunner.run("echo $((6 * 7))");
    assert.match(stdout, /^42$/mu);
  });

  it("brace expansion expands to space-separated values", async () => {
    const { stdout } = await ShellAuditHookRunner.run("echo {alpha,beta,gamma}");
    assert.match(stdout, /alpha beta gamma/u);
  });

  it("brace-expansion range", async () => {
    const { stdout } = await ShellAuditHookRunner.run("echo {1..5}");
    assert.match(stdout, /1 2 3 4 5/u);
  });

  it("printf with tab + newline escapes", async () => {
    const { stdout } = await ShellAuditHookRunner.run(
      String.raw`printf 'col1\tcol2\ncol3\tcol4\n'`,
    );
    assert.match(stdout, /col1\tcol2/u);
    assert.match(stdout, /col3\tcol4/u);
  });

  it("for-loop emits each iteration", async () => {
    const { stdout } = await ShellAuditHookRunner.run("for i in 1 2 3; do echo iter-$i; done");
    assert.match(stdout, /iter-1/u);
    assert.match(stdout, /iter-2/u);
    assert.match(stdout, /iter-3/u);
  });

  it("while-loop counts to 3", async () => {
    const { stdout } = await ShellAuditHookRunner.run(
      "i=0; while [ $i -lt 3 ]; do echo n=$i; i=$((i+1)); done",
    );
    assert.match(stdout, /n=0/u);
    assert.match(stdout, /n=1/u);
    assert.match(stdout, /n=2/u);
    assert.doesNotMatch(stdout, /n=3/u);
  });

  it("if/then picks then-branch", async () => {
    const { stdout } = await ShellAuditHookRunner.run(
      "if [ 1 -eq 1 ]; then echo yes-branch; else echo no-branch; fi",
    );
    assert.match(stdout, /yes-branch/u);
    assert.doesNotMatch(stdout, /no-branch/u);
  });

  it("if/else picks else-branch", async () => {
    const { stdout } = await ShellAuditHookRunner.run(
      "if [ 1 -eq 2 ]; then echo yes-branch; else echo no-branch; fi",
    );
    assert.match(stdout, /no-branch/u);
    assert.doesNotMatch(stdout, /yes-branch/u);
  });

  it("case statement matches the right arm", async () => {
    const { stdout } = await ShellAuditHookRunner.run(
      "case foo in bar) echo bar-arm;; foo) echo foo-arm;; *) echo wild;; esac",
    );
    assert.match(stdout, /foo-arm/u);
    assert.doesNotMatch(stdout, /bar-arm/u);
    assert.doesNotMatch(stdout, /wild/u);
  });

  it("|| fallback runs after failure", async () => {
    const { stdout } = await ShellAuditHookRunner.run("false || echo fallback-ran");
    assert.match(stdout, /fallback-ran/u);
  });

  it("|| chain short-circuits on success", async () => {
    const { stdout } = await ShellAuditHookRunner.run("echo first-ok || echo never");
    assert.match(stdout, /first-ok/u);
    assert.doesNotMatch(stdout, /never/u);
  });

  it("subshell can mutate without affecting parent var", async () => {
    const { stdout } = await ShellAuditHookRunner.run(
      "X=outer; (X=inner; echo sub=$X); echo parent=$X",
    );
    assert.match(stdout, /sub=inner/u);
    assert.match(stdout, /parent=outer/u);
  });

  it("function definition + call", async () => {
    const { stdout } = await ShellAuditHookRunner.run("greet() { echo hi-$1; }; greet world");
    assert.match(stdout, /hi-world/u);
  });

  it("complex loop with conditional + redirects to both streams", async () => {
    const { stdout, stderr } = await ShellAuditHookRunner.run(
      "for i in 1 2 3; do if [ $((i % 2)) -eq 0 ]; then echo even-$i >&2; else echo odd-$i; fi; done",
    );
    assert.match(stdout, /odd-1/u);
    assert.match(stdout, /odd-3/u);
    assert.doesNotMatch(stdout, /even-/u);
    assert.match(stderr, /even-2/u);
    assert.doesNotMatch(stderr, /odd-/u);
  });

  it("multi-line output preserves line count", async () => {
    const { stdout } = await ShellAuditHookRunner.run("seq 1 10");
    const lines = stdout.split("\n").filter((line) => /^\d+$/u.test(line));
    assert.equal(lines.length, 10);
  });

  it("seq 1..100: head and tail values present", async () => {
    const { stdout } = await ShellAuditHookRunner.run("seq 1 100");
    assert.match(stdout, /^1$/mu);
    assert.match(stdout, /^50$/mu);
    assert.match(stdout, /^100$/mu);
  });

  it("xargs across pipe handles whitespace", async () => {
    const { stdout } = await ShellAuditHookRunner.run("echo 'a b c' | xargs -n1 echo item:");
    assert.match(stdout, /item: a/u);
    assert.match(stdout, /item: b/u);
    assert.match(stdout, /item: c/u);
  });

  it("awk computes a running total", async () => {
    const { stdout } = await ShellAuditHookRunner.run("seq 1 10 | awk '{s+=$1} END{print s}'");
    assert.match(stdout, /^55$/mu);
  });

  it("sed -n range filter", async () => {
    const { stdout } = await ShellAuditHookRunner.run("seq 1 10 | sed -n '3,5p'");
    assert.match(stdout, /^3$/mu);
    assert.match(stdout, /^4$/mu);
    assert.match(stdout, /^5$/mu);
    assert.doesNotMatch(stdout, /^2$/mu);
    assert.doesNotMatch(stdout, /^6$/mu);
  });

  it("complex: pipeline + loop + arithmetic, mixed streams", async () => {
    const { stdout, stderr } = await ShellAuditHookRunner.run(
      'for n in $(seq 1 4); do v=$((n*n)); echo "square($n)=$v"; echo "log($n)" >&2; done | sort',
    );
    assert.match(stdout, /square\(1\)=1/u);
    assert.match(stdout, /square\(2\)=4/u);
    assert.match(stdout, /square\(3\)=9/u);
    assert.match(stdout, /square\(4\)=16/u);
    assert.match(stderr, /log\(1\)/u);
    assert.match(stderr, /log\(4\)/u);
  });

  it("single quotes preserve dollar literal", async () => {
    const { stdout } = await ShellAuditHookRunner.run("echo 'literal $X dollar'");
    assert.match(stdout, /literal \$X dollar/u);
  });

  it("double quotes expand variables", async () => {
    const { stdout } = await ShellAuditHookRunner.run(`X=expanded; echo "value=$X"`);
    assert.match(stdout, /value=expanded/u);
  });

  it("ampersand background then wait", async () => {
    const { stdout } = await ShellAuditHookRunner.run(
      "(sleep 0.05; echo bg-done) & wait; echo after-wait",
    );
    assert.match(stdout, /bg-done/u);
    assert.match(stdout, /after-wait/u);
  });

  it("process substitution <(cmd) feeds diff", async () => {
    const { stdout } = await ShellAuditHookRunner.run(
      "diff <(echo same) <(echo same) && echo identical",
    );
    assert.match(stdout, /identical/u);
  });

  it("process substitution detects difference", async () => {
    const { stdout, stderr } = await ShellAuditHookRunner.run(
      "diff <(echo a) <(echo b) || echo differ-flag",
    );
    assert.match(stdout, /differ-flag/u);
    assert.doesNotMatch(stderr, /differ-flag/u);
  });

  it("here-string <<< feeds stdin", async () => {
    const { stdout } = await ShellAuditHookRunner.run("cat <<< 'piped-via-herestring'");
    assert.match(stdout, /piped-via-herestring/u);
  });

  it(`parameter expansion: \${var//pat/repl} replaces all`, async () => {
    const { stdout } = await ShellAuditHookRunner.run(`s='aXbXcXd'; echo \${s//X/-}`);
    assert.match(stdout, /a-b-c-d/u);
  });

  it(`parameter expansion: \${var:offset:length} substring`, async () => {
    const { stdout } = await ShellAuditHookRunner.run(`s=abcdefgh; echo \${s:2:4}`);
    assert.match(stdout, /^cdef$/mu);
  });

  it(`parameter expansion: \${var:-default} fallback`, async () => {
    const { stdout } = await ShellAuditHookRunner.run(`unset X; echo \${X:-fallback-value}`);
    assert.match(stdout, /fallback-value/u);
  });

  it(`parameter expansion: \${#var} length`, async () => {
    const { stdout } = await ShellAuditHookRunner.run(`s='hello'; echo len=\${#s}`);
    assert.match(stdout, /len=5/u);
  });

  it(`indirect variable reference \${!name}`, async () => {
    const { stdout } = await ShellAuditHookRunner.run(`X=value; PTR=X; echo got=\${!PTR}`);
    assert.match(stdout, /got=value/u);
  });

  it("[[ regex match operator", async () => {
    const { stdout } = await ShellAuditHookRunner.run(
      `s='abc123'; [[ $s =~ ^[a-z]+([0-9]+)$ ]] && echo digits=\${BASH_REMATCH[1]}`,
    );
    assert.match(stdout, /digits=123/u);
  });

  it("elif chain picks middle branch", async () => {
    const { stdout } = await ShellAuditHookRunner.run(
      "n=2; if [ $n -eq 1 ]; then echo one; elif [ $n -eq 2 ]; then echo two; elif [ $n -eq 3 ]; then echo three; else echo other; fi",
    );
    assert.match(stdout, /^two$/mu);
    assert.doesNotMatch(stdout, /one/u);
    assert.doesNotMatch(stdout, /three/u);
    assert.doesNotMatch(stdout, /other/u);
  });

  it("set -e in subshell aborts at first failure", async () => {
    const { stdout } = await ShellAuditHookRunner.run(
      "(set -e; echo before; false; echo never-printed) ; echo after-sub",
    );
    assert.match(stdout, /before/u);
    assert.match(stdout, /after-sub/u);
    assert.doesNotMatch(stdout, /never-printed/u);
  });

  it("set -o pipefail flips exit code on early pipe failure", async () => {
    const { stdout } = await ShellAuditHookRunner.run(
      "set -o pipefail; (false | true) || echo pipefail-caught",
    );
    assert.match(stdout, /pipefail-caught/u);
  });

  it("read from /proc/self/comm yields a non-empty name", async () => {
    const { stdout } = await ShellAuditHookRunner.run("cat /proc/self/comm");
    assert.match(stdout, /\S/u);
  });

  it("base64 round-trip preserves text", async () => {
    const { stdout } = await ShellAuditHookRunner.run(
      "echo 'round-trip-payload' | base64 | base64 -d",
    );
    assert.match(stdout, /round-trip-payload/u);
  });

  it("printf into wc -c counts bytes", async () => {
    const { stdout } = await ShellAuditHookRunner.run("printf '12345' | wc -c");
    assert.match(stdout, /^5$/mu);
  });

  it("sort + uniq -c counts duplicates", async () => {
    const { stdout } = await ShellAuditHookRunner.run(
      String.raw`printf 'a\nb\na\nc\nb\na\n' | sort | uniq -c | awk '{print $2"="$1}'`,
    );
    assert.match(stdout, /a=3/u);
    assert.match(stdout, /b=2/u);
    assert.match(stdout, /c=1/u);
  });

  it("read line-by-line in while loop", async () => {
    const { stdout } = await ShellAuditHookRunner.run(
      String.raw`printf 'one\ntwo\nthree\n' | while read line; do echo got:$line; done`,
    );
    assert.match(stdout, /got:one/u);
    assert.match(stdout, /got:two/u);
    assert.match(stdout, /got:three/u);
  });

  it("trap EXIT fires on script end", async () => {
    const { stdout } = await ShellAuditHookRunner.run("trap 'echo trap-fired' EXIT; echo body");
    assert.match(stdout, /body/u);
    assert.match(stdout, /trap-fired/u);
    const bodyIdx = stdout.indexOf("body");
    const trapIdx = stdout.indexOf("trap-fired");
    assert.ok(bodyIdx !== -1 && trapIdx > bodyIdx, "trap should fire after body");
  });

  it("recursive function: factorial(5) = 120", async () => {
    const { stdout } = await ShellAuditHookRunner.run(
      "fact() { if [ $1 -le 1 ]; then echo 1; else echo $(( $1 * $(fact $(($1 - 1))) )); fi; }; fact 5",
    );
    assert.match(stdout, /^120$/mu);
  });

  it("multi-line assignment with backslash continuation", async () => {
    const { stdout } = await ShellAuditHookRunner.run(
      'X=$(echo \\\n a \\\n b \\\n c); echo "[$X]"',
    );
    assert.match(stdout, /\[a b c\]/u);
  });

  it("env propagation: stdin-supplied value reaches inner cmd", async () => {
    const { stdout } = await ShellAuditHookRunner.run("V=42 bash -c 'echo nested=$V'");
    assert.match(stdout, /nested=42/u);
  });

  it("complex jq-style awk: pick column-2 from CSV", async () => {
    const { stdout } = await ShellAuditHookRunner.run(
      String.raw`printf 'a,1\nb,2\nc,3\n' | awk -F, '{print $2}'`,
    );
    assert.match(stdout, /^1$/mu);
    assert.match(stdout, /^2$/mu);
    assert.match(stdout, /^3$/mu);
  });

  it("compound: find-like ls + filter + count", async () => {
    const { stdout } = await ShellAuditHookRunner.run("ls /usr/bin | grep -c '^[a-d]'");
    assert.match(stdout, /^\d+$/mu);
  });

  it("mapfile reads lines into array", async () => {
    const { stdout } = await ShellAuditHookRunner.run(
      `mapfile -t arr < <(printf 'x\\ny\\nz\\n'); echo n=\${#arr[@]}; echo first=\${arr[0]}; echo last=\${arr[2]}`,
    );
    assert.match(stdout, /n=3/u);
    assert.match(stdout, /first=x/u);
    assert.match(stdout, /last=z/u);
  });

  it("declare -A associative array", async () => {
    const { stdout } = await ShellAuditHookRunner.run(
      `declare -A m; m[foo]=1; m[bar]=2; echo foo=\${m[foo]}; echo bar=\${m[bar]}`,
    );
    assert.match(stdout, /foo=1/u);
    assert.match(stdout, /bar=2/u);
  });

  it("compound stream redirection: stdout→file, stderr stays", async () => {
    const { stdout, stderr } = await ShellAuditHookRunner.run(
      "tmp=$(mktemp); { echo to-file; echo to-stderr >&2; } > $tmp; cat $tmp; rm $tmp",
    );
    assert.match(stdout, /to-file/u);
    assert.match(stderr, /to-stderr/u);
    assert.doesNotMatch(stdout, /to-stderr/u);
  });

  it("very-complex: build pipeline that emits and dedups + sorts numerically + caps", async () => {
    const { stdout } = await ShellAuditHookRunner.run(
      "for i in 5 3 5 1 4 3 2 5; do echo $i; done | sort -n | uniq | head -3",
    );
    assert.match(stdout, /^1$/mu);
    assert.match(stdout, /^2$/mu);
    assert.match(stdout, /^3$/mu);
    assert.doesNotMatch(stdout, /^4$/mu);
  });

  describe("CLAUDE_SHELL_DEBUGGER toggle", () => {
    const runHookRaw = async ({
      command,
      envOverrides,
    }: {
      command: string;
      envOverrides: NodeJS.ProcessEnv;
    }): Promise<HookOutput> => {
      const input: HookInput = { tool_input: { command }, tool_name: "Bash" };
      const baseEnv: NodeJS.ProcessEnv = { ...process.env, HOOK_INPUT: JSON.stringify(input) };
      delete baseEnv["CLAUDE_SHELL_DEBUGGER"];
      const { stdout } = await execAsync(`printf '%s' "$HOOK_INPUT" | node ${HOOK}`, {
        env: { ...baseEnv, ...envOverrides },
        shell: "/bin/sh",
      });
      return JSON.parse(stdout.toString());
    };

    it("passes command through unchanged when CLAUDE_SHELL_DEBUGGER is unset", async () => {
      const out = await runHookRaw({ command: "echo hello", envOverrides: {} });
      assert.equal(out.hookSpecificOutput.updatedInput.command, "echo hello");
    });

    it("passes command through unchanged when CLAUDE_SHELL_DEBUGGER=false", async () => {
      const out = await runHookRaw({
        command: "echo hello",
        envOverrides: { CLAUDE_SHELL_DEBUGGER: "false" },
      });
      assert.equal(out.hookSpecificOutput.updatedInput.command, "echo hello");
    });

    it("wraps command with command-runner.ts when CLAUDE_SHELL_DEBUGGER=true", async () => {
      const out = await runHookRaw({
        command: "echo hello",
        envOverrides: { CLAUDE_SHELL_DEBUGGER: "true" },
      });
      const wrapped = out.hookSpecificOutput.updatedInput.command;
      assert.match(wrapped, /^node '.*\/command-runner\.ts' 'echo hello'$/u);
    });

    it("preserves single quotes in command via sh-quoting when wrapped", async () => {
      const out = await runHookRaw({
        command: "echo 'it''s'",
        envOverrides: { CLAUDE_SHELL_DEBUGGER: "true" },
      });
      const wrapped = out.hookSpecificOutput.updatedInput.command;
      assert.match(wrapped, /'echo '\\''it'\\'''\\''s'\\'''/u);
    });
  });
});
