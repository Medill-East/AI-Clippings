---
name: obsidian-web-clipper-ingest
description: Fully automate saving web links into an Obsidian vault through the installed Obsidian Web Clipper Chrome extension. Use when the user gives one or more article links, especially WeChat article URLs, and wants Codex to open them in Chrome, scroll through the page, wait for the extension's AI summary to finish, and click Add to Obsidian without manual browser interaction.
---

# Obsidian Web Clipper Ingest

Use this skill when the user provides one or more links and wants them clipped into Obsidian through the existing Chrome + Obsidian Web Clipper setup.

## Workflow

1. Run `node ./scripts/setup.js` once to create `local/config.json` and validate Chrome, profile, and extension paths.
2. The automation starts its own isolated browser profile, so it does not need to take over your live Chrome session.
3. Run one of:
   - `node ./scripts/clip-links.js "<url>"`
   - `node ./scripts/clip-links.js "<url1>" "<url2>" ...`
   - `node ./scripts/clip-links.js --input <file>`
4. Read the final run summary in `local/runs/<timestamp>/manifest.json`.
5. If a URL fails, inspect the screenshot path recorded in the manifest and retry that URL after fixing the page or extension state.

## Operating Rules

- Keep Chrome headed. The installed extension and Obsidian deep link flow rely on a real interactive browser.
- Reuse the existing Chrome user data directory and `Default` profile from `local/config.json`.
- Start from a clean automation profile and copy only the Obsidian Web Clipper storage needed to preserve your template and vault settings.
- Do not ask the user to click the extension UI manually. The automation uses the extension's embedded iframe path instead of the browser side panel because browser chrome is not reliably scriptable.
- Treat the clip as ready only when the iframe shows `Add to Obsidian` and the button is enabled.
- Scroll the page from top to bottom before opening the clipper iframe so lazy content loads on long articles.
- Stage multiple pages in parallel for AI summarization. Open, scroll, and start clipping each page one by one, then let the summary phase overlap across up to `maxConcurrentSummaries` pages.
- Before saving, pre-authorize the automation profile for the `obsidian://` protocol and force the extension's automation profile to use `silentOpen: true` so the run is not blocked by external-app prompts.
- Treat a clip as truly successful only when the expected note is detected in the target Obsidian vault after clicking `Add to Obsidian`.

## Files

- Main entrypoints:
  - `node ./scripts/setup.js`
  - `node ./scripts/clip-links.js`
- Runtime reference:
  - [references/obsidian-clipper-ui.md](./references/obsidian-clipper-ui.md)

## Outputs

- `local/config.json`
- `local/runs/<timestamp>/manifest.json`
- `local/runs/<timestamp>/screenshots/*.png`

## Recovery

- If the run times out waiting for `Add to Obsidian`, open the recorded screenshot and check whether the page failed to load, the interpreter is still running, or the extension showed an error.
- If the extension iframe never appears, re-run `node ./scripts/setup.js` and confirm the extension ID and Chrome profile are still correct.
- If Obsidian does not receive the clip, inspect the manifest first. A `success` result now requires an actual vault file match; if the run fails after clicking `Add to Obsidian`, the protocol permission or vault target still needs attention.
