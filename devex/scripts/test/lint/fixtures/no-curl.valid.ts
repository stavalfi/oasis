// @ts-nocheck
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function ok(): Promise<void> {
  await execFileAsync("git", ["status"]);
}
