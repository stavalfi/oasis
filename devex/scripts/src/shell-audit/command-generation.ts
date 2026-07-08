import { Readable } from "node:stream";
import { boolean } from "boolean";
import path from "node:path";
import { z } from "zod";
import { CommandRewriter } from "./command-rewriter.ts";

const HookInputSchema = z.object({
  tool_input: z.object({ command: z.string().min(1) }),
  tool_name: z.string().min(1),
});

const HookOutputSchema = z.object({
  hookSpecificOutput: z.object({
    hookEventName: z.literal("PreToolUse"),
    updatedInput: z.object({
      command: z.string().min(1),
    }),
  }),
});

type HookInput = z.infer<typeof HookInputSchema>;
type HookOutput = z.infer<typeof HookOutputSchema>;

const input = HookInputSchema.parse(
  JSON.parse(await new Response(Readable.toWeb(process.stdin)).text()),
);

class CommandGen {
  public static shSingleQuote(s: string): string {
    return `'${s.replaceAll("'", `'\\''`)}'`;
  }
}

const rewrittenCommand = new CommandRewriter().rewrite(input.tool_input.command);
const debuggerEnabled = boolean(process.env["CLAUDE_SHELL_DEBUGGER"]);
const runnerPath = path.resolve(import.meta.dirname, "command-runner.ts");
let command: string;
if (debuggerEnabled) {
  command = `node ${CommandGen.shSingleQuote(runnerPath)} ${CommandGen.shSingleQuote(rewrittenCommand)}`;
} else {
  command = rewrittenCommand;
}

const output: HookOutput = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    updatedInput: { command },
  },
};

console.log(JSON.stringify(output));

export type { HookInput, HookOutput };
