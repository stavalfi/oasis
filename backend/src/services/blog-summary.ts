/**
 * blog-summary.ts
 *
 * Handles one blog-post message from Kafka: idempotency check, AI summary, Jira
 * ticket creation (with the service-account token), and recording the result.
 * Idempotency is enforced via the `blog_posts` table: a post that already has a
 * row is skipped, so Kafka's at-least-once redelivery never double-files.
 * Transient failures (AI, or a Jira 5xx/network error) are rethrown so the offset
 * stays uncommitted and the message is retried; a Jira 4xx (bad input or
 * permission) is a poison message, logged and dropped so it does not loop forever.
 * An AIonLabs 429 is neither: it surfaces as a RateLimitError that propagates to
 * the consumer, which pauses the partition for a fixed window rather than
 * tight-looping.
 */
import type { AiSummaryClient } from "../ai/ai-client.ts";
import { config } from "../config.ts";
import { JiraApiError } from "../jira/errors/jira-api-error.ts";
import { jiraClient } from "../jira/jira.ts";
import type { BlogPostMessage } from "../kafka/schemas.ts";
import type { Logger } from "../lib/logger.ts";
import { logger } from "../lib/logger.ts";
import { BlogPostsModel } from "../models/blog-posts.ts";

/** The Jira service-account credentials and target project for summary tickets. */
export interface JiraSummaryConfig {
  apiToken: string;
  baseUrl: string;
  cloudId: string;
  email: string;
  projectKey: string;
}

/** Smallest client HTTP error status (4xx are terminal, not retried). */
const CLIENT_ERROR_STATUS = 400;
/** Smallest server HTTP error status (5xx are transient, retried). */
const SERVER_ERROR_STATUS = 500;

export class BlogSummaryService {
  readonly #aiClient: AiSummaryClient;
  readonly #jiraSummary: JiraSummaryConfig;
  readonly #logger: Logger;

  public constructor({
    aiClient,
    jiraSummary,
  }: {
    aiClient: AiSummaryClient;
    jiraSummary: JiraSummaryConfig;
  }) {
    this.#aiClient = aiClient;
    this.#jiraSummary = jiraSummary;
    this.#logger = logger.child({ component: "blog-summary" });
  }

  /**
   * Process one blog-post message. Skips a post already filed; otherwise
   * summarizes it, creates the Jira ticket, and records the issue key. Throws on
   * a transient failure so Kafka redelivers; swallows a Jira 4xx (poison).
   *
   * @param message - the validated Kafka message (post url, title, content).
   */
  public async handle(message: BlogPostMessage): Promise<void> {
    const existing = await BlogPostsModel.findByUrl(message.postUrl);
    if (existing !== undefined) {
      this.#logger.info(
        { issueKey: existing.jiraIssueKey, postUrl: message.postUrl },
        "Post already filed; skipping.",
      );
      return;
    }

    this.#logger.info({ postUrl: message.postUrl, title: message.title }, "sumaries...");

    const summary = await this.#aiClient.summarize({
      content: message.content,
      title: message.title,
    });

    const created = await this.#createIssue({
      postUrl: message.postUrl,
      summary,
      title: message.title,
    });
    if (created === undefined) {
      return;
    }

    await BlogPostsModel.recordFiled({
      jiraIssueKey: created.key,
      postUrl: message.postUrl,
      summary,
      title: message.title,
    });
    this.#logger.info(
      { issueKey: created.key, postUrl: message.postUrl, url: created.url },
      "Filed blog-summary ticket.",
    );
  }

  /**
   * Create the Jira ticket for a post. Returns the created issue, or undefined
   * for a Jira 4xx (poison: logged and dropped). Rethrows a 5xx/network error so
   * the caller lets Kafka redeliver.
   */
  async #createIssue({
    postUrl,
    title,
    summary,
  }: {
    postUrl: string;
    title: string;
    summary: string;
  }): Promise<{ key: string; url: string } | undefined> {
    try {
      return await jiraClient.createIssueWithToken({
        apiToken: this.#jiraSummary.apiToken,
        cloudId: this.#jiraSummary.cloudId,
        description: `${summary}\n\nSource: ${postUrl}`,
        email: this.#jiraSummary.email,
        projectKey: this.#jiraSummary.projectKey,
        siteUrl: this.#jiraSummary.baseUrl,
        title: `${config.constants.blogSummary.titlePrefix}${title}`,
      });
    } catch (error: unknown) {
      if (
        error instanceof JiraApiError &&
        error.status >= CLIENT_ERROR_STATUS &&
        error.status < SERVER_ERROR_STATUS
      ) {
        this.#logger.error(
          { detail: error.detail, postUrl, status: error.status },
          "Jira rejected the summary ticket (4xx); dropping this post.",
        );
        return undefined;
      }
      throw error;
    }
  }
}
