// @ts-nocheck
export function bad1(): void {
  process.stdout.write("hello\n");
}

export function bad2(): void {
  process.stderr.write("error\n");
}
