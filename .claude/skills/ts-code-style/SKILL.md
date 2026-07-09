---
name: ts-code-style
description: Standards for writing standalone TypeScript scripts. Use when writing any standalone .ts file (not part of a compiled app). Enforces ESM vs CJS detection, full type safety, async-only, and IO schema validation.
allowed-tools: Read, Bash, Glob, Grep, Edit, Write
---

When writing a standalone TypeScript script, apply the following rules unconditionally.

## 1. Detect ESM vs CJS

Read the nearest `package.json` (starting from the script's directory, walking up). Check the `"type"` field:

- `"type": "module"` → **ESM**: use `import`/`export`, `import.meta.url`, `import.meta.dirname` (Node 22+) or derive `__dirname` via `fileURLToPath`:
  ```ts
  import { fileURLToPath } from "url";
  import { dirname } from "path";
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  ```
- `"type": "commonjs"` or absent → **CJS**: use `require`/`module.exports`, `__dirname` natively.

Never mix styles. Never use `require()` in ESM or `import.meta` in CJS.

## 2. Type Safety — Hard Rules

These are non-negotiable:

- **No `any`** — use `unknown` and narrow with type guards or zod `.parse()`
- **No `as` casts** — no `foo as Bar`, no `<Bar>foo`
- **No non-null assertions (`!`)** — use explicit null checks or optional chaining + early returns
- **No `@ts-ignore` / `@ts-expect-error`** — fix the type issue instead
- **No implicit `any`** — always annotate function parameters
- **Descriptive names** — variables, parameters, methods, classes, and types must clearly convey their purpose; no single-letter names (except loop indices like `i`), no abbreviations like `res`, `val`, `tmp`, `obj`, `data` without a qualifier (e.g. `userData`, `responseBody`)
- **No `\n` for line endings in file writes** — use `os.EOL` from the `os` module
- **Use `console.log` for output** — not `process.stdout.write`, unless you need to avoid trailing newlines or write binary data
- **Minimal public surface** — every field and method is `private` by default. Only promote to `public` what is explicitly needed by callers outside the class. Never leave visibility unspecified — always write `private`, `protected`, or `public` explicitly.
- **All class fields must be `readonly` unless they hold mutable instance state** — state that genuinely changes across the object's lifetime is the only exception. If a value is only used during one method call (computed once, consumed by helpers), do not store it on the instance. Pass it as a method parameter instead.
- **All functions live inside a class** — no module-level functions, no module-level helpers, no `const fn = () => …` at the top level. The only top-level statements allowed are imports, type/schema declarations, `const execAsync = promisify(exec)` (the recommended async alias), and the single entry-point call. Pure helper methods that don't use `this` are still allowed inside the class; do not enable `class-methods-use-this` — it conflicts with this rule.

## 3. Async — Hard Rules

- **No sync I/O** — never use `fs.readFileSync`, `fs.writeFileSync`, `execSync`, etc. Always use the async variants (`fs.readFile`, `fs.writeFile`, or `import { readFile } from "fs/promises"`)
- **No `new Promise()` wrapping sync code** — that's not async
- **No `.then()` or `.catch()`** — always use `async`/`await` with `try`/`catch`
- **No `Promise.resolve()`** — never wrap a sync value to fit into `Promise.all`. Restructure so the sync result is computed inline outside the `Promise.all`, or make the function actually async.
- **Shell commands** — declare `execAsync` as a module-level alias (not inside the class), then use it directly in instance methods:

  ```ts
  import { exec } from "child_process";
  import { promisify } from "util";

  const execAsync = promisify(exec);

  class MyScript {
    private readonly abortController = new AbortController();

    private async doSomething(): Promise<void> {
      const { stdout } = await execAsync("some command", {
        signal: this.abortController.signal,
      });
    }
  }
  ```

  - **Avoid `spawn`** unless you need live/streaming output (e.g. tailing a process in real time)
  - If a command produces large output and `execAsync` throws `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`, increase the buffer only as a last resort:
    ```ts
    await execAsync("big-output-command", { maxBuffer: 10 * 1024 * 1024 }); // 10 MB
    ```
    Do not pre-emptively increase the buffer — only do it when you have evidence the default (1 MB) is insufficient.

- **Entry point**:
  - ESM (top-level `await`): call `await new MyScript().run()` directly. The constructor takes no arguments — it creates its own `AbortController` and registers `SIGTERM` internally (see section 5).
  - CJS (no top-level `await`): wrap in an async IIFE — no `.then()` or `.catch()`, let unhandled rejections propagate:
    ```ts
    (async () => {
      // setup + await script.run()
    })();
    ```

## 4. IO Schema Validation

Any data arriving from outside the process must be validated before use:

- **CLI arguments** — parse with a schema (zod, or manual type guards); never blindly index `process.argv`
- **File contents** — parse with `JSON.parse` + zod `.parse()` (not `.safeParse()` unless you handle both branches)
- **Network responses** — validate the response body with zod before accessing fields
- **Environment variables** — validate at startup, fail fast with a clear error if required vars are missing

Example pattern:

```ts
import { z } from "zod";
import { readFile } from "fs/promises";

const ConfigSchema = z.object({
  endpoint: z.string().url(),
  timeout: z.number().positive(),
});

const rawConfig: unknown = JSON.parse(await readFile("config.json", "utf8"));
const config = ConfigSchema.parse(rawConfig); // throws with a clear message if invalid
```

## 5. Cancellation — Hard Rules

Every script must support graceful cancellation via `AbortController` and respond to `SIGTERM`.

- **Create `AbortController` as a private field inside the class** — not outside it. Register `SIGTERM` in the constructor:

  ```ts
  class MyScript {
    private readonly abortController = new AbortController();

    public constructor() {
      process.once("SIGTERM", () => this.abortController.abort());
    }
  }
  ```

- **Only listen for `SIGTERM`** — do not listen for `SIGINT`
- **Pass `this.abortController.signal` to all cancellable APIs** (`fetch`, `execAsync`, `readFile`, streams, etc.)
- **Check `this.abortController.signal.aborted` in loops** so long-running iterations exit cleanly:
  ```ts
  for (const item of items) {
    if (this.abortController.signal.aborted) break;
    await this.processItem(item);
  }
  ```
- **Handle `AbortError` in `run()`** — set exit code 1 and return. On _any_ caught error, call `abort()` on the controller first (if not already aborted) so in-flight async work tears down cleanly:
  ```ts
  public async run(): Promise<void> {
    try {
      // ... all logic inline; no separate execute() method
    } catch (error: unknown) {
      if (!this.abortController.signal.aborted) {
        this.abortController.abort();
      }
      if (error instanceof Error && error.name === "AbortError") {
        process.exitCode = 1;
        return;
      }
      throw error;
    }
  }
  ```
- **Don't split `run()` into `run()` + `execute()`** — keep the try/catch wrapper directly around the entry-point logic. The extra method adds noise without value.

## 6. Structure — Classes vs Functions

- **For anything beyond a trivial script** (more than one logical step, reusable helpers, or state): use a **class**. Put all logic as methods — no standalone functions outside the class.
- **No static methods or static fields** — use instance methods and instance fields only.
- **No global variables** — the only top-level code allowed outside the class is: imports, schema/type definitions, the single entry-point call, and **module-level function aliases** (e.g. `const execAsync = promisify(exec)`). These are aliases, not state — they are the recommended way to wrap global functions.
- The public entry point is `run()` on the instance. The constructor parses args and stores them as `private readonly` fields:

  ```ts
  class MyScript {
    private readonly abortController = new AbortController();
    private readonly args: z.infer<typeof ArgsSchema>;

    public constructor() {
      process.once("SIGTERM", () => this.abortController.abort());
      this.args = ArgsSchema.parse({ input: process.argv[2] });
    }

    public async run(): Promise<void> {
      try {
        await this.execute();
      } catch (error: unknown) {
        if (error instanceof Error && error.name === "AbortError") {
          process.exitCode = 1;
          return;
        }
        throw error;
      }
    }

    private async execute(): Promise<void> {
      // ...
    }
  }
  ```

- A "very small" script is one with a single linear flow and no reusable pieces — a plain `async function main()` is acceptable there.

## 7. Error Handling — Hard Rules

- **Let errors propagate** — do not catch unless you have a specific recovery action or the user explicitly asks for custom error messages
- **Never swallow errors in `catch`** — a `catch` block that silently returns / continues / converts the error to a benign value hides bugs. Every catch must either rethrow, set `process.exitCode` and exit, or convert the error to a _first-class result_ (e.g. a `TaskResult` that's reported and contributes to a non-zero exit code). Filtering for file presence is the only exception — wrap that in a dedicated `fileExists(path): Promise<boolean>` helper so the catch is local and explicit.
- **No `.catch()`** — use `try`/`catch` instead; `.catch()` obscures the stack and can silently exit with code 0
- **No `process.exit`** — let the process exit naturally from an unhandled throw
- **No wrapping errors in new messages** unless you are genuinely adding context the original error lacks
- The only legitimate catch is for `AbortError` (signal cancellation), handled in `run()` (see section 5)
- If the user wants a custom error message for a specific failure, wrap only that specific operation and rethrow with added context

## 8. Template Skeleton

### ESM (`"type": "module"`) — class-based

```ts
import { exec } from "child_process";
import { readFile } from "fs/promises";
import { EOL } from "os";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { promisify } from "util";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const execAsync = promisify(exec);

const ArgsSchema = z.object({
  input: z.string(),
});

class MyScript {
  private readonly abortController = new AbortController();
  private readonly args: z.infer<typeof ArgsSchema>;

  public constructor() {
    process.once("SIGTERM", () => this.abortController.abort());
    this.args = ArgsSchema.parse({ input: process.argv[2] });
  }

  public async run(): Promise<void> {
    try {
      await this.execute();
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        process.exitCode = 1;
        return;
      }
      throw error;
    }
  }

  private async execute(): Promise<void> {
    const rawFileContent: unknown = JSON.parse(
      await readFile(join(__dirname, this.args.input), {
        encoding: "utf8",
        signal: this.abortController.signal,
      }),
    );
    // ...
  }
}

await new MyScript().run();
```

### CJS (`"type": "commonjs"` or absent) — class-based

Same as ESM, but wrap the entry point in an async IIFE (no top-level `await`):

```ts
(async () => {
  await new MyScript().run();
})();
```

never import like this: await import("fs/promises"). always import at the top of the file.

- avoid using defaults unless there is a demand for it or you have to.
