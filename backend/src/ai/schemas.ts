/**
 * schemas.ts
 *
 * Zod schema for the part of the AIonLabs (OpenAI-compatible) chat-completions
 * response that AiSummaryClient consumes. Parsing the response through this
 * schema (rather than trusting the raw shape) keeps the client robust and yields
 * a clean, narrow value.
 */
import { z } from "zod";

/** A chat-completions response: we only need the first choice's message content. */
export const chatCompletionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});
