---
name: gdoc
description: Create a new Google Doc or append content to an existing one from a Markdown file, via the devex update-gdoc CLI. Use when the user asks to write to, update, append to, or create a Google Doc.
argument-hint: [doc-url-or-id] [what to write]
allowed-tools: Bash, Write
---

Render a Markdown file into a Google Doc using the `devex update-gdoc` command
(`devex/scripts/src/cli/devex/update-gdoc/index.ts`).

## Command

```bash
npm run cli devex update-gdoc --file <markdown-file> [--doc-id <id>] [--replace] [--title <title>]
```

Run it from the repo root (where `package.json` defines the `cli` script).

- `--file` (required): the Markdown file to render.
- `--doc-id` (optional): append to this existing doc. Omit to create a NEW doc; the new doc's URL is printed at the end.
- `--replace` (optional, needs `--doc-id`): clear the doc body first, then write the
  file fresh. Use this to REBUILD a doc in place instead of appending. This is how you
  "modify" or fix an existing doc.
- `--title` (optional, new docs only): defaults to the first H1 heading, else the filename.

## Step 1 — Write the Markdown

Write the content to a temp file, e.g. `/tmp/gdoc-content.md`. Supported Markdown:

- Headings `#`, `##`, `###` (deeper levels clamp to H3)
- Paragraphs (consecutive lines join into one)
- Bullet lists (`-` / `*`) and ordered lists (`1.`)
- `**bold**` (rendered bold) and `` `inline code` `` (backticks stripped) -- in
  headings, paragraphs and list items ONLY
- Tables (GitHub pipe syntax, with the `|---|` separator row). Cells are inserted
  as PLAIN TEXT: `**bold**` and backticks are NOT processed inside a cell and show
  up literally. Keep cells plain. A cell must not contain a `|` (it splits columns)
  or a newline.
- Blockquotes `>` (rendered as plain paragraphs)
- `---` horizontal rules are ignored

## Step 2 — Get the doc id (for updates)

The doc id is the path segment in the URL:
`https://docs.google.com/document/d/<DOC_ID>/edit` -> `<DOC_ID>`.

## Step 3 — Run

Append to an existing doc:

```bash
npm run cli devex update-gdoc --file /tmp/gdoc-content.md --doc-id <DOC_ID>
```

Rebuild an existing doc in place (clear then write fresh):

```bash
npm run cli devex update-gdoc --file /tmp/gdoc-content.md --doc-id <DOC_ID> --replace
```

Create a new doc:

```bash
npm run cli devex update-gdoc --file /tmp/gdoc-content.md --title "My Doc"
```

On success it prints `Done: https://docs.google.com/document/d/<id>/edit`. Relay that URL.

## Important behavior

- Without `--replace` the command ONLY APPENDS to the end of the doc; it cannot insert
  at the top or reorder. To change existing content, use `--replace`, which deletes the
  whole body and rewrites it from your Markdown (so your file must contain the FULL
  desired document, not just the change). The body's final newline cannot be deleted,
  so a rebuilt doc may start with one blank line.
- It cannot READ a doc. You cannot inspect existing content this way, so you cannot
  know what is already there or de-duplicate against it. With `--replace` you do not
  need to read it: you are overwriting the whole body.

## Auth

- The OAuth client secret is read from KeePassXC via `secret-tool` (entry
  `google-docs-claude-code` / `Google Docs OAuth Client Secret`). KeePassXC must be
  unlocked.
- First run with no saved token opens a browser for one-time Google consent. The
  refresh token is then cached at `devex/output/.gdocs_token.json` for reuse.
- Scope is `https://www.googleapis.com/auth/documents` (Docs only). The
  authenticated Google account must already have edit access to the target doc.
