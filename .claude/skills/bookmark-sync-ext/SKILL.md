---
name: bookmark-sync-ext
description: How to update and deploy the POC Bookmarks Chrome extension. Use when making changes to files under devex/bookmark-sync-chrome-extention/.
allowed-tools: Read, Bash, Edit, Write
---

## Updating the Chrome extension

When making code changes to the bookmark sync extension (`devex/bookmark-sync-chrome-extention/extention/`):

1. **Make the code changes** in `src/background.ts`, `src/native-host.ts`, or `src/types.ts`
2. **Bump the version** in `extention/manifest.json` (e.g. `"1.0.0"` → `"1.0.1"`)
3. **Run the install script**:
   ```bash
   node --experimental-strip-types devex/bookmark-sync-chrome-extention/extention/install-and-reload.ts
   ```

The script will:

- Compare the manifest version against the running extension (via Unix socket at `/tmp/poc-bookmarks.sock`)
- Skip if the running version is already >= local version
- Build TypeScript (`npm run build`)
- Install native messaging host manifests for Chrome and Chromium
- Trigger extension reload via sentinel file
- Wait until the extension reports back the new version

**Important**: always bump the version before running the script, otherwise it skips the update.

## Project structure

```
devex/bookmark-sync-chrome-extention/
├── .keys/                    # PEM key for stable extension ID (gitignored)
├── extention/
│   ├── src/
│   │   ├── background.ts    # Chrome extension service worker
│   │   ├── native-host.ts   # Node.js native messaging host
│   │   └── types.ts         # Shared message types
│   ├── e2e/
│   │   └── e2e.test.ts      # E2E tests
│   ├── dist/                 # Build output
│   ├── manifest.json         # Chrome extension manifest (version lives here)
│   ├── main.sh               # Entry point for native host (Chrome spawns this)
│   ├── install-and-reload.ts # Install + reload script
│   └── tsconfig.json
└── poc-bookmarks/          # Synced .url files (one per bookmark)
```

## Running tests

```bash
node --experimental-strip-types --test devex/bookmark-sync-chrome-extention/extention/e2e/e2e.test.ts
```
