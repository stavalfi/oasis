import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { scheduler } from "node:timers/promises";
import { tmpdir } from "node:os";
import { z } from "zod";

const execFileAsync = promisify(execFile);

const UNT_SCRIPT_PATH = path.resolve(import.meta.dirname, "../src/unt.ts");

const ExecFailureSchema = z.object({
  code: z.number().optional(),
  stderr: z.string().optional(),
  stdout: z.string().optional(),
});

const VERIFICATION_COMMAND_PATTERN = new RegExp(
  [
    "^cat ",
    String.raw`(?<logPath>/tmp/utl/[0-9a-f]+\.log)`,
    String.raw` \| grep `,
    "(?<grepArgs>.+)",
    "$",
  ].join(""),
  "u",
);

export interface UntRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface UntVerificationCommand {
  readonly logPath: string;
  readonly grepArgs: string;
}

export class UntTestHelper {
  public static async createWorkspace(): Promise<{
    workDir: string;
    flagFile: string;
  }> {
    const workDir = await mkdtemp(path.join(tmpdir(), "unt-test-"));
    return {
      flagFile: path.join(workDir, "flag.txt"),
      workDir,
    };
  }

  public static async scheduleFlagWrite({
    flagFile,
    content,
    delayMs,
  }: {
    flagFile: string;
    content: string;
    delayMs: number;
  }): Promise<void> {
    await scheduler.wait(delayMs);
    await writeFile(flagFile, content);
  }

  public static async runUnt(args: readonly string[]): Promise<UntRunResult> {
    const { stdout, stderr } = await execFileAsync(UNT_SCRIPT_PATH, args);
    return {
      exitCode: 0,
      stderr,
      stdout,
    };
  }

  public static async runUntAllowFailure(args: readonly string[]): Promise<UntRunResult> {
    try {
      return await UntTestHelper.runUnt(args);
    } catch (error: unknown) {
      const failed = ExecFailureSchema.safeParse(error);
      if (!failed.success) {
        throw error;
      }
      return {
        exitCode: failed.data.code ?? 1,
        stderr: failed.data.stderr ?? "",
        stdout: failed.data.stdout ?? "",
      };
    }
  }

  public static parseVerificationCommand(stdout: string): UntVerificationCommand {
    const trimmed = stdout.trim();
    const match = VERIFICATION_COMMAND_PATTERN.exec(trimmed);
    if (match === null) {
      throw new Error(`unt stdout did not match 'cat <log> | grep <args>': ${trimmed}`);
    }
    const logPath = match.groups?.["logPath"];
    const grepArgs = match.groups?.["grepArgs"];
    if (logPath === undefined || grepArgs === undefined) {
      throw new Error(`parsed verification command missing captures: ${trimmed}`);
    }
    return {
      grepArgs,
      logPath,
    };
  }

  public static readLogFile(logPath: string): Promise<string> {
    return readFile(logPath, "utf8");
  }
}
