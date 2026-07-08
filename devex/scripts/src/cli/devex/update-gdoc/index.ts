import { type Command } from "@commander-js/extra-typings";
import { authenticate } from "@google-cloud/local-auth";
import { execFile } from "node:child_process";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { google, type docs_v1 } from "googleapis";
import { z } from "zod";

const execFileAsync = promisify(execFile);

const SCOPES = ["https://www.googleapis.com/auth/documents"];

// A run of text with the character ranges (relative to `text`) that are bold.
interface Inline {
  text: string;
  bold: { start: number; end: number }[];
}

type Block =
  | { type: "heading"; level: 1 | 2 | 3; inline: Inline }
  | { type: "paragraph"; inline: Inline }
  | { type: "bullet"; inline: Inline }
  | { type: "ordered"; inline: Inline }
  | { type: "table"; headers: string[]; rows: string[][] };

const ClientConfigSchema = z.object({
  client_id: z.string(),
  client_secret: z.string(),
});

const ClientSecretJsonSchema = z.object({
  installed: ClientConfigSchema.optional(),
  web: ClientConfigSchema.optional(),
});

const SavedTokenSchema = z.object({
  refresh_token: z.string(),
});

export class UpdateGdocCommand {
  readonly #repoRoot: string;

  public constructor({ repoRoot }: { repoRoot: string; signal: AbortSignal }) {
    this.#repoRoot = repoRoot;
  }

  public register(parent: Command): void {
    parent
      .command("update-gdoc")
      .description(
        "Append a Markdown file to a Google Doc via the Docs API. With --doc-id it appends to that doc; without it a new doc is created and its URL is printed.",
      )
      .requiredOption("--file <path>", "Markdown file to render into the doc")
      .option("--doc-id <id>", "Existing Google Doc id to append to (omit to create a new doc)")
      .option(
        "--replace",
        "With --doc-id, clear the doc body first and rebuild it from the file instead of appending",
      )
      .option(
        "--title <title>",
        "Title for a newly created doc (defaults to the first H1 or the filename)",
      )
      .action(async (options) => {
        await this.#run(options);
      });
  }

  // ---- Markdown parsing -----------------------------------------------------

  // Splits a line into plain text plus the ranges that should be bold.
  // Handles **bold** and strips `inline code` backticks (kept as plain text).
  static #parseInline(raw: string): Inline {
    let text = "";
    const bold: { start: number; end: number }[] = [];
    let i = 0;
    while (i < raw.length) {
      const boldEnd = raw.startsWith("**", i) ? raw.indexOf("**", i + 2) : -1;
      const codeEnd = raw[i] === "`" ? raw.indexOf("`", i + 1) : -1;
      if (boldEnd >= 0) {
        const start = text.length;
        text += raw.slice(i + 2, boldEnd).replaceAll("`", "");
        bold.push({ end: text.length, start });
        i = boldEnd + 2;
      } else if (codeEnd >= 0) {
        text += raw.slice(i + 1, codeEnd);
        i = codeEnd + 1;
      } else {
        text += raw[i];
        i += 1;
      }
    }
    return { bold, text };
  }

  static #isTableLine(line: string): boolean {
    return /^\s*\|.*\|\s*$/u.test(line);
  }

  static #headingLevel(depth: number): 1 | 2 | 3 {
    if (depth <= 1) {
      return 1;
    }
    if (depth === 2) {
      return 2;
    }
    return 3;
  }

  static #splitTableRow(line: string): string[] {
    return line
      .trim()
      .replace(/^\|/u, "")
      .replace(/\|$/u, "")
      .split("|")
      .map((cell) => cell.trim());
  }

  // Consumes consecutive table lines starting at `start`; returns the parsed
  // table block (if any) and the index of the last consumed line.
  static #consumeTable({ lines, start }: { lines: string[]; start: number }): {
    block: Extract<Block, { type: "table" }> | undefined;
    end: number;
  } {
    const tableLines: string[] = [];
    let end = start;
    while (end < lines.length) {
      const tl = lines[end];
      if (tl === undefined || !UpdateGdocCommand.#isTableLine(tl)) {
        break;
      }
      tableLines.push(tl);
      end += 1;
    }
    // Drop the |---|---| separator row if present, then split header/body.
    const dataRows = tableLines
      .map((l) => UpdateGdocCommand.#splitTableRow(l))
      .filter((row) => !row.every((c) => /^:?-+:?$/u.test(c)));
    const headers = dataRows.shift();
    const block = headers ? { headers, rows: dataRows, type: "table" as const } : undefined;
    return { block, end: end - 1 };
  }

  static #parseMarkdown(markdown: string): Block[] {
    const lines = markdown.replaceAll("\r\n", "\n").split("\n");
    const blocks: Block[] = [];

    // Buffer for a paragraph/list-item that may span continuation lines.
    let buffer: { type: "paragraph" | "bullet" | "ordered"; lines: string[] } | undefined;
    const flush = (): void => {
      if (buffer) {
        const inline = UpdateGdocCommand.#parseInline(buffer.lines.join(" ").trim());
        if (inline.text.length > 0) {
          blocks.push({ inline, type: buffer.type });
        }
        buffer = undefined;
      }
    };

    for (let i = 0; i < lines.length; i += 1) {
      const rawLine = lines[i];
      if (rawLine !== undefined) {
        const line = rawLine.replace(/\s+$/u, "");
        const heading = /^(?<hashes>#{1,3})\s+(?<text>.*)$/u.exec(line);
        const bullet = /^\s*[-*]\s+(?<text>.*)$/u.exec(line);
        const ordered = /^\s*\d+\.\s+(?<text>.*)$/u.exec(line);
        const quote = /^>\s?(?<text>.*)$/u.exec(line);

        if (line.trim().length === 0) {
          flush();
        } else if (UpdateGdocCommand.#isTableLine(line)) {
          flush();
          const { block, end } = UpdateGdocCommand.#consumeTable({ lines, start: i });
          i = end;
          if (block) {
            blocks.push(block);
          }
        } else if (heading) {
          flush();
          const depth = (heading.groups?.["hashes"] ?? "").length;
          const level = UpdateGdocCommand.#headingLevel(depth);
          blocks.push({
            inline: UpdateGdocCommand.#parseInline(heading.groups?.["text"] ?? ""),
            level,
            type: "heading",
          });
        } else if (/^---+\s*$/u.test(line)) {
          flush();
        } else if (bullet) {
          flush();
          buffer = { lines: [bullet.groups?.["text"] ?? ""], type: "bullet" };
        } else if (ordered) {
          flush();
          buffer = { lines: [ordered.groups?.["text"] ?? ""], type: "ordered" };
        } else {
          const content = quote?.groups?.["text"] ?? line;
          if (buffer && /^\s/u.test(line) && !quote) {
            // Indented line continues the current paragraph/list item.
            buffer.lines.push(content.trim());
          } else if (buffer && buffer.type === "paragraph") {
            buffer.lines.push(content.trim());
          } else {
            flush();
            buffer = { lines: [content.trim()], type: "paragraph" };
          }
        }
      }
    }
    flush();

    return blocks;
  }

  // ---- Auth -----------------------------------------------------------------

  static async #getClientSecretJson(): Promise<string> {
    const { stdout } = await execFileAsync("secret-tool", [
      "lookup",
      "UserName",
      "google-docs-claude-code",
      "Title",
      "Google Docs OAuth Client Secret",
    ]);
    return stdout.trim();
  }

  static async #getRefreshToken({
    clientSecretJson,
    tokenPath,
  }: {
    clientSecretJson: string;
    tokenPath: string;
  }): Promise<string> {
    const tokenExists = await access(tokenPath)
      .then(() => true)
      .catch(() => false);
    if (tokenExists) {
      const { refresh_token } = SavedTokenSchema.parse(
        JSON.parse(await readFile(tokenPath, "utf8")),
      );
      return refresh_token;
    }

    console.log("no saved token — opening browser for one-time Google consent...");
    const tmpPath = path.join(tmpdir(), `gdocs-secret-${Date.now()}.json`);
    await writeFile(tmpPath, clientSecretJson);

    try {
      const client = await authenticate({ keyfilePath: tmpPath, scopes: SCOPES });
      const refreshToken = client.credentials.refresh_token;
      if (!refreshToken) {
        throw new Error("OAuth flow did not return a refresh token");
      }
      await writeFile(tokenPath, JSON.stringify({ refresh_token: refreshToken }));
      return refreshToken;
    } finally {
      await rm(tmpPath, { force: true });
    }
  }

  // ---- Doc writing ----------------------------------------------------------

  static #docEndIndex(document: docs_v1.Schema$Document): number {
    const content = document.body?.content ?? [];
    return content.at(-1)?.endIndex ?? 1;
  }

  // Removes all body content so the doc can be rebuilt from scratch. The body's
  // final newline cannot be deleted, so we stop one index short of the end.
  static async #clearDocBody({
    docs,
    documentId,
  }: {
    docs: docs_v1.Docs;
    documentId: string;
  }): Promise<void> {
    const doc = await docs.documents.get({ documentId });
    const deleteEnd = UpdateGdocCommand.#docEndIndex(doc.data) - 1;
    if (deleteEnd > 1) {
      await docs.documents.batchUpdate({
        documentId,
        requestBody: {
          requests: [{ deleteContentRange: { range: { endIndex: deleteEnd, startIndex: 1 } } }],
        },
      });
    }
  }

  // Appends one text paragraph (heading / body / list item) to the end of the doc.
  static async #appendTextBlock({
    docs,
    documentId,
    block,
  }: {
    docs: docs_v1.Docs;
    documentId: string;
    block: Extract<Block, { type: "heading" | "paragraph" | "bullet" | "ordered" }>;
  }): Promise<void> {
    const doc = await docs.documents.get({ documentId });
    const insertIndex = Math.max(1, UpdateGdocCommand.#docEndIndex(doc.data) - 1);
    const { text } = block.inline;
    const start = insertIndex + 1; // after the leading "\n"
    const end = start + text.length;

    const namedStyleType = block.type === "heading" ? `HEADING_${block.level}` : "NORMAL_TEXT";

    const requests: docs_v1.Schema$Request[] = [
      { insertText: { location: { index: insertIndex }, text: `\n${text}` } },
      {
        updateParagraphStyle: {
          fields: "namedStyleType",
          paragraphStyle: { namedStyleType },
          range: { endIndex: end, startIndex: start },
        },
      },
    ];

    if (block.type === "bullet" || block.type === "ordered") {
      requests.push({
        createParagraphBullets: {
          bulletPreset:
            block.type === "ordered" ? "NUMBERED_DECIMAL_ALPHA_ROMAN" : "BULLET_DISC_CIRCLE_SQUARE",
          range: { endIndex: end, startIndex: start },
        },
      });
    } else {
      // Headings and normal paragraphs inserted right after a list would
      // otherwise inherit its bullet (Google Docs copies list membership onto
      // the new paragraph). Clear it so only real list items are bulleted.
      requests.push({
        deleteParagraphBullets: { range: { endIndex: end, startIndex: start } },
      });
    }

    for (const range of block.inline.bold) {
      requests.push({
        updateTextStyle: {
          fields: "bold",
          range: { endIndex: start + range.end, startIndex: start + range.start },
          textStyle: { bold: true },
        },
      });
    }

    await docs.documents.batchUpdate({ documentId, requestBody: { requests } });
  }

  // Appends an empty table sized for the block, then fills its cells.
  static async #appendTable({
    docs,
    documentId,
    block,
  }: {
    docs: docs_v1.Docs;
    documentId: string;
    block: Extract<Block, { type: "table" }>;
  }): Promise<void> {
    const allRows = [block.headers, ...block.rows];
    const columns = Math.max(...allRows.map((row) => row.length));

    await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [{ insertTable: { columns, endOfSegmentLocation: {}, rows: allRows.length } }],
      },
    });

    const doc = await docs.documents.get({ documentId });
    const tables = (doc.data.body?.content ?? []).filter((el) => el.table);
    const lastTable = tables.at(-1)?.table;
    const tableRows = lastTable?.tableRows ?? [];

    const cells: { index: number; text: string }[] = [];
    tableRows.forEach((row, r) => {
      (row.tableCells ?? []).forEach((cell, c) => {
        const startIndex = cell.content?.[0]?.startIndex;
        const text = allRows[r]?.[c];
        if (typeof startIndex === "number" && text !== undefined && text.length > 0) {
          cells.push({ index: startIndex, text });
        }
      });
    });

    // Insert highest index first so earlier cell indices stay valid.
    cells.sort((a, b) => b.index - a.index);
    const requests: docs_v1.Schema$Request[] = cells.map(({ index, text }) => ({
      insertText: { location: { index }, text },
    }));

    if (requests.length > 0) {
      await docs.documents.batchUpdate({ documentId, requestBody: { requests } });
    }
  }

  async #run({
    file,
    docId,
    title,
    replace,
  }: {
    file: string;
    docId?: string;
    title?: string;
    replace?: boolean;
  }): Promise<void> {
    const markdown = await readFile(path.resolve(file), "utf8");
    const blocks = UpdateGdocCommand.#parseMarkdown(markdown);
    if (blocks.length === 0) {
      throw new Error(`No content parsed from ${file}`);
    }

    const tokenPath = path.join(this.#repoRoot, "devex", "output", ".gdocs_token.json");

    console.log("fetching credentials from KeePassXC...");
    const clientSecretJson = await UpdateGdocCommand.#getClientSecretJson();
    const parsed = ClientSecretJsonSchema.parse(JSON.parse(clientSecretJson));
    const config = parsed.installed ?? parsed.web;
    if (!config) {
      throw new Error("Invalid client secret JSON: missing 'installed' or 'web' key");
    }

    const refreshToken = await UpdateGdocCommand.#getRefreshToken({ clientSecretJson, tokenPath });

    const auth = new google.auth.OAuth2(config.client_id, config.client_secret);
    auth.setCredentials({ refresh_token: refreshToken });

    const docs = google.docs({ auth, version: "v1" });

    let documentId = docId;
    if (documentId === undefined) {
      const firstHeading = blocks.find((b) => b.type === "heading");
      const docTitle =
        title ??
        (firstHeading?.type === "heading" ? firstHeading.inline.text : undefined) ??
        path.basename(file, path.extname(file));
      console.log(`creating new doc: ${docTitle}`);
      const created = await docs.documents.create({ requestBody: { title: docTitle } });
      documentId = created.data.documentId ?? undefined;
      if (documentId === undefined) {
        throw new Error("Docs API did not return a documentId for the new doc");
      }
    } else if (replace) {
      console.log(`rebuilding existing doc: ${documentId}`);
      await UpdateGdocCommand.#clearDocBody({ docs, documentId });
    } else {
      console.log(`appending to existing doc: ${documentId}`);
    }

    for (const block of blocks) {
      if (block.type === "table") {
        console.log(`inserting table (${block.rows.length} rows)`);
        await UpdateGdocCommand.#appendTable({ block, docs, documentId });
      } else {
        await UpdateGdocCommand.#appendTextBlock({ block, docs, documentId });
      }
    }

    console.log(`Done: https://docs.google.com/document/d/${documentId}/edit`);
  }
}
