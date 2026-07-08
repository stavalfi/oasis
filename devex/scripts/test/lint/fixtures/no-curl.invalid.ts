// @ts-nocheck
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function bad1(): Promise<void> {
  await execFileAsync("curl", ["-s", "https://example.com"]);
}

export async function bad2(): Promise<void> {
  await execFileAsync("wget", ["-q", "https://example.com"]);
}
