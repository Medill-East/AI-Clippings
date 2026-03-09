---
name: wechat-filehelper-link-ingest
description: Extract non-video links from the Windows WeChat desktop app File Transfer Assistant, keep a local link index, and query links by time range.
---

# WeChat FileHelper Link Ingest

Use this skill when Codex needs to scan the Windows WeChat desktop app's File Transfer Assistant, extract real article links, and return or summarize links for a time range such as the last hour or the last week.

## Workflow

1. Manually open WeChat and make sure the current chat is already `File Transfer Assistant`.
2. Run the read-only diagnosis first:
   - `powershell -ExecutionPolicy Bypass -File .\scripts\diagnose-filehelper.ps1`
3. For production single-article scanning, use:
   - `powershell -ExecutionPolicy Bypass -File .\scripts\scan-single-article-links.ps1 -Since <ISO8601> -Until <ISO8601> [-MaxScrolls N] [-Reindex]`
4. Query the local index:
   - `powershell -ExecutionPolicy Bypass -File .\scripts\query-links.ps1 -Since <ISO8601> -Until <ISO8601> [-Format text|json|md]`
5. Inspect the run manifest in `local/runs/<timestamp>/manifest.json`.

## Operating Rules

- `diagnose-filehelper.ps1` is the default troubleshooting entrypoint and only reads current UI state.
- `scan-single-article-links.ps1` is the only production scanner. It only handles text URLs and single article cards.
- Production scanning skips chat-record bundles, videos, and unknown message types.
- Production scanning performs discovery first and only then opens single article cards one by one.
- If the environment is unsafe, production scanning fails fast before opening any article.
- `scan-filehelper.ps1` remains a debug-only script and is not the recommended production entrypoint.
- `scan-single-article-experimental.ps1` remains a dangerous experiment script and is not part of the normal workflow.
- `extract-current-article-link.ps1` is now an internal production helper called by the single-article scanner.
- The scanner only supports the current WeChat main chat window when the selected chat is already `File Transfer Assistant`.
- Allowed UI scope is limited to:
  - WeChat main chat window
  - WeChat built-in article viewer
  - Controlled default-browser fallback for address-bar reading
- Supported non-video message types:
  - visible text URLs
  - article share cards
- Video-style items are skipped and counted in logs/manifest instead of being indexed.
- Query results are deduped by real URL by default.

## Outputs

- `local/runs/<timestamp>/artifacts/visible-items.json` for diagnosis mode
- `local/runs/<timestamp>/artifacts/candidates.json` for single-article production scans
- `local/index/links.jsonl`
- `local/runs/<timestamp>/manifest.json`
- `local/runs/<timestamp>/artifacts/*.log`

## Recovery

- If WeChat has shown instability, rerun `diagnose-filehelper.ps1` before any active scan.
- If the current chat is not `File Transfer Assistant`, switch to it manually and rerun.
- If diagnosis reports that single-article mode is blocked, do not run the production scanner until the reported windows are closed and the chat list is visible again.
- If a share card opens but no URL is resolved, inspect the production run log before retrying.
- If the production scanner reports a fatal main-window stability error, stop and return WeChat to a normal `File Transfer Assistant` state before the next run.
