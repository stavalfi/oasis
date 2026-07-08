/**
 * Runs a user command, streams stdout/stderr live, captures them,
 * and appends a single complete entry to the daily log under `flock`.
 *
 * Inputs (env):
 *   CLAUDE_SHELL_OUTPUT_UUID   pinned UUID for this invocation (else generated)
 *   CLAUDE_SHELL_OUTPUT_DIR    log directory (else defaults under repo root)
 * Inputs (argv):
 *   process.argv[2]            the user's bash command (one string)
 */

import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

class CliError extends Error {
  public readonly exitCode: number;
  public constructor({ message, exitCode = 1 }: { message: string; exitCode?: number }) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

try {
  const { 2: originalCommand } = process.argv;
  if (originalCommand === undefined || originalCommand.length === 0) {
    throw new CliError({ exitCode: 2, message: "command-runner: missing command argument" });
  }

  const uuid = process.env["CLAUDE_SHELL_OUTPUT_UUID"] ?? randomUUID().slice(0, 8);

  const rootRepoPath = path.resolve(import.meta.dirname, "../../../..");
  const logDir =
    process.env["CLAUDE_SHELL_OUTPUT_DIR"] ??
    path.join(rootRepoPath, "devex", "output", "claude-shell-output-logs");
  const today = new Date().toISOString().slice(0, 10);
  const logPath = path.join(logDir, `${today}.log`);
  await mkdir(logDir, { recursive: true });

  const proofLine = `proof ${uuid}`;
  const dateResult = await execFileAsync("date", ["-Iseconds"]);
  const timestamp = dateResult.stdout.trim();

  const t0 = process.hrtime.bigint();
  const child = spawn("bash", ["-c", originalCommand], { stdio: ["inherit", "pipe", "pipe"] });

  let combined = "";
  child.stdout.on("data", (chunk: Buffer) => {
    combined += chunk.toString();
    console.log(chunk.toString());
  });
  child.stderr.on("data", (chunk: Buffer) => {
    combined += chunk.toString();
    console.error(chunk.toString());
  });

  const exitCode: number = await new Promise<number>((resolve) => {
    child.on("close", (code) => resolve(code ?? 0));
  });
  const durationSec = (Number(process.hrtime.bigint() - t0) / 1e9).toFixed(3);

  console.log(`duration: ${durationSec}s\n`);
  console.log(`${proofLine}\n`);

  let outputBlock: string;
  if (combined.endsWith("\n") || combined.length === 0) {
    outputBlock = combined;
  } else {
    outputBlock = `${combined}\n`;
  }
  const entry =
    `---------------------\n` +
    `start-uuid="${uuid}"\n` +
    `command: "${originalCommand}"\n` +
    `timestamp: "${timestamp}"\n` +
    `output:\n${outputBlock}duration: ${durationSec}s\n` +
    `exit-code: ${exitCode}\n${proofLine}\nend-uuid="${uuid}"\n` +
    `\n`;

  await appendFile(logPath, entry);
} catch (error) {
  if (error instanceof CliError) {
    console.error(error.message);
    process.exitCode = error.exitCode;
  } else {
    throw error;
  }
}
