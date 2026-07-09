/**
 * ai-client.ts
 *
 * The single class through which the backend calls the AIonLabs API
 * (OpenAI-compatible chat completions). Used by the blog-summary consumer to
 * summarize a blog post before filing it as a Jira ticket. Nothing else in the
 * backend calls AIonLabs.
 *
 * Transport: direct `fetch` is banned repo-wide, so this uses `ky`, which retries
 * the completion POST on 429 only (a rate-limited request was rejected before
 * processing, so retrying cannot double-charge) with jittered backoff.
 */
import ky from "ky";
import { config } from "../config.ts";
import { RateLimitError } from "../lib/rate-limit-error.ts";
import { chatCompletionSchema } from "./schemas.ts";

/** HTTP status for a rate-limited request (honor Retry-After, then pause). */
const TOO_MANY_REQUESTS_STATUS = 429;

type KyInstance = ReturnType<typeof ky.create>;

/** The chat messages sent to the model. */
interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export class AiSummaryClient {
  /** ky bound to the completion endpoint: retry on 429 only, honoring Retry-After. */
  readonly #ky: KyInstance;
  /** The AIonLabs API key (Bearer credential). Kept private, never logged. */
  readonly #apiKey: string;

  public constructor(apiKey: string) {
    this.#apiKey = apiKey;
    this.#ky = ky.create({
      retry: {
        afterStatusCodes: [429],
        jitter: true,
        limit: config.constants.ai.maxRetries,
        methods: ["post"],
        statusCodes: [429],
      },
      throwHttpErrors: false,
      timeout: config.constants.ai.requestTimeoutMs,
    });
  }

  /** Build the system + user messages that ask for a concise, factual summary. */
  static #buildMessages({ title, content }: { title: string; content: string }): ChatMessage[] {
    return [
      {
        content:
          "You are a security analyst assistant. Summarize the following Non-Human " +
          "Identity (NHI) / security blog post in 3-5 concise, factual sentences suitable " +
          "for a Jira ticket description. Do not add a preamble, headings, or bullet points; " +
          "return only the summary prose.",
        role: "system",
      },
      { content: `Title: ${title}\n\n${content}`, role: "user" },
    ];
  }

  /**
   * Summarize a blog post. Returns the model's summary text, trimmed and capped
   * to the Jira description length limit. Throws on a non-success response or an
   * empty completion, so the caller can retry (leave the Kafka offset uncommitted).
   *
   * @param title - the blog post title.
   * @param content - the extracted (already truncated) post body.
   */
  public async summarize({ title, content }: { title: string; content: string }): Promise<string> {
    const response = await this.#ky(`${config.constants.ai.baseUrl}/chat/completions`, {
      headers: { Authorization: `Bearer ${this.#apiKey}` },
      json: {
        max_tokens: config.constants.ai.maxTokens,
        messages: AiSummaryClient.#buildMessages({ content, title }),
        model: config.constants.ai.model,
        temperature: config.constants.ai.temperature,
      },
      method: "post",
    });
    if (response.status === TOO_MANY_REQUESTS_STATUS) {
      throw new RateLimitError("AIonLabs rate-limited the summary request (429).");
    }
    if (!response.ok) {
      throw new Error(`AIonLabs request failed with status ${response.status}.`);
    }
    const body: unknown = await response.json();
    const parsed = chatCompletionSchema.parse(body);
    const summary = parsed.choices[0]?.message.content.trim() ?? "";
    if (summary.length === 0) {
      throw new Error("AIonLabs returned an empty summary.");
    }
    return summary.slice(0, config.constants.validation.descriptionMaxLength);
  }
}
