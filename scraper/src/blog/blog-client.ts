/**
 * blog-client.ts
 *
 * The single class through which the scraper fetches the Oasis blog. It reads the
 * server-rendered listing HTML (Webflow) and each post page with `ky`, and parses
 * them with `cheerio`. Nothing else fetches oasis.security. Direct `fetch` is
 * banned repo-wide, so `ky` is used (idempotent GETs, jittered backoff on
 * transient statuses).
 *
 * The parsing selectors are the one fragile external contract; they are isolated
 * here so a layout change fails loudly in one place.
 */
import { load } from "cheerio";
import ky from "ky";
import { config } from "../config.ts";

type KyInstance = ReturnType<typeof ky.create>;

/** A discovered post: its canonical URL and title. */
export interface BlogPostRef {
  url: string;
  title: string;
}

/** Card container selectors: the featured post and the grid items. */
const CARD_SELECTOR = ".blog_main-item, .resources-new_item";
/** Post-body container in a Webflow rich-text article. */
const RICHTEXT_SELECTOR = ".w-richtext";
/** Post links point at /blog/<slug>; this prefix identifies a post URL. */
const POST_PATH_PREFIX = "/blog/";

export class OasisBlogClient {
  /** ky for the blog GETs: retry transient statuses with jittered backoff. */
  readonly #ky: KyInstance;

  public constructor() {
    this.#ky = ky.create({
      headers: { "user-agent": config.constants.blog.userAgent },
      retry: {
        afterStatusCodes: [429, 503],
        jitter: true,
        limit: config.constants.blog.maxRetries,
        methods: ["get"],
        statusCodes: [408, 429, 500, 502, 503, 504],
      },
      timeout: config.constants.blog.requestTimeoutMs,
    });
  }

  /** Collapse whitespace and trim. */
  static #normalize(text: string): string {
    return text.replaceAll(/\s+/gu, " ").trim();
  }

  /**
   * Parse the listing HTML into post references (newest first, deduped), capped
   * at `maxPostsPerCycle`. Throws if the page yields no posts, so a layout change
   * surfaces as a loud failure rather than silently doing nothing.
   */
  static #parseListing(html: string): BlogPostRef[] {
    const $ = load(html);
    const posts: BlogPostRef[] = [];
    const seen = new Set<string>();
    for (const element of $(CARD_SELECTOR)) {
      const card = $(element);
      const href = card.find(`a[href^="${POST_PATH_PREFIX}"]`).first().attr("href");
      // Title, in priority order: the Finsweet list field, then any heading.
      const title = OasisBlogClient.#normalize(
        card.find('[fs-list-field="title"], h1, h2, h3, h4, h5, h6').first().text(),
      );
      const isPost = href !== undefined && href.length > POST_PATH_PREFIX.length;
      if (isPost && title.length > 0) {
        const url = new URL(href, config.constants.blog.listUrl).toString();
        if (!seen.has(url)) {
          seen.add(url);
          posts.push({ title, url });
        }
      }
    }
    if (posts.length === 0) {
      throw new Error("Blog listing yielded no posts; the page layout may have changed.");
    }
    return posts.slice(0, config.constants.blog.maxPostsPerCycle);
  }

  /**
   * Extract the readable body text of a post: the longest rich-text block on the
   * page, whitespace-normalized and truncated to the input budget. Falls back to
   * the given title when no body text is found, so the message is never empty.
   */
  static #parseContent({ html, title }: { html: string; title: string }): string {
    const $ = load(html);
    let longest = "";
    for (const element of $(RICHTEXT_SELECTOR)) {
      const text = OasisBlogClient.#normalize($(element).text());
      if (text.length > longest.length) {
        longest = text;
      }
    }
    const body = longest.length > 0 ? longest : title;
    return body.slice(0, config.constants.blog.summaryInputMaxChars);
  }

  /** Fetch and parse the listing into post references (newest first). */
  public async fetchPosts(): Promise<BlogPostRef[]> {
    const html = await this.#ky(config.constants.blog.listUrl).text();
    return OasisBlogClient.#parseListing(html);
  }

  /**
   * Fetch a post page and extract its body text for summarization.
   *
   * @param post - the post reference (url used to fetch, title used as fallback).
   */
  public async fetchContent(post: BlogPostRef): Promise<string> {
    const html = await this.#ky(post.url).text();
    return OasisBlogClient.#parseContent({ html, title: post.title });
  }
}
