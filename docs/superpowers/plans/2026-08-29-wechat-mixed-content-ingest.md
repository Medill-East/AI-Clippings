# WeChat Mixed-Content Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the macOS WeChat FileHelper collector reliably capture article cards, rich-media cards, Video Channels links, image OCR content, and direct URLs, then publish each supported type through the correct PKM path without silent loss.

**Architecture:** Keep `/Users/haodong/Documents/AI/Codex/Clippings` as the source of truth, merge the divergent GitHub history without force-pushing, and retain the current `/sph/` video pipeline. Extend the existing UI-first scanner with conservative pre-click identity, typed image candidates, explicit unresolved records, a small deterministic image-to-Obsidian publisher, and per-type manifest accounting.

**Tech Stack:** Node.js ES modules, `node:test`, macOS AppleScript/System Events, Apple Vision OCR through the existing Swift helper, JSONL indexes, Markdown/Obsidian, Git worktrees.

---

## File map

- `wechat-filehelper-macos-ingest/scripts/lib/ui.js`: OCR block discovery, candidate identity, viewer classification, article/video/image extraction, and per-page outcome accounting.
- `wechat-filehelper-macos-ingest/scripts/lib/image-content.js`: pure image OCR record construction plus deterministic, verified Obsidian Markdown publication.
- `wechat-filehelper-macos-ingest/scripts/lib/scan.js`: persist links, image content, unresolved items, and type-accounting manifest fields.
- `wechat-filehelper-macos-ingest/scripts/lib/query.js`: expose `image_contents` and `unresolved_items` without mixing them into article URLs.
- `wechat-filehelper-macos-ingest/scripts/collect-links.js`: display all result groups and preserve the existing video batch order.
- `wechat-filehelper-macos-ingest/test/ui.test.js`: regression coverage for direct URLs, dedupe, rich-media viewer readiness, video failure records, and image viewer confirmation.
- `wechat-filehelper-macos-ingest/test/image-content.test.js`: record schema, confidence state, Markdown rendering, verified write, and explicit failure tests.
- `wechat-filehelper-macos-ingest/test/scan-flow.test.js`: index persistence and manifest accounting integration.
- `wechat-filehelper-macos-ingest/test/query-links.test.js`: JSON/Markdown output routing for images and unresolved items.
- `wechat-filehelper-macos-ingest/SKILL.md`: operator contract and new output groups.
- `ProjectInfo/ProjectProgress.md`, `ProjectInfo/dialogues/2026-0829.md`, and a topic file under `ProjectInfo/sessions/`: required project snapshot and session evidence.

### Task 1: Reconcile the divergent Git histories in the isolated worktree

**Files:**
- Merge: `origin/main` into `codex/wechat-mixed-content-fixes`
- Preserve: `wechat-filehelper-macos-ingest/scripts/lib/video-channel-*.js`
- Preserve: `wechat-filehelper-macos-ingest/scripts/process-video-channels.js`
- Remove after merge if introduced: `wechat-filehelper-macos-ingest/scripts/lib/system-audio-capture.swift`
- Remove after merge if introduced: `wechat-filehelper-macos-ingest/scripts/lib/video-capture.js`
- Remove after merge if introduced: `wechat-filehelper-macos-ingest/scripts/lib/video-pipeline.js`
- Remove after merge if introduced: `wechat-filehelper-macos-ingest/scripts/lib/video.js`
- Remove after merge if introduced: `wechat-filehelper-macos-ingest/scripts/process-videos.js`
- Remove after merge if introduced: `wechat-filehelper-macos-ingest/test/video.test.js`

- [ ] **Step 1: Record the two parent commits**

Run:

```bash
git rev-parse HEAD origin/main
git merge-base HEAD origin/main
```

Expected: two different heads with common ancestor `14913fd493056925b6f4ce17696991eb80b28996`.

- [ ] **Step 2: Record the remote history without textually interleaving the two incompatible rewrites**

An attempted `git merge --no-ff --no-commit -X ours origin/main` was executed in the isolated worktree and produced 50 test failures. The merged `ui.js` contained calls such as `buildViewerOcrContext` and `SUPPORTED_SHARE_CARD_TYPES` without their definitions, while also crossing the superseded pending-video stack with the current `/sph/` stack. This proves that hunk-level auto-merge is not a valid behavioral reconciliation for these independently rewritten files.

Run:

```bash
git merge --no-ff --no-commit -s ours origin/main
```

Expected: merge stops before commit with no tracked tree changes. The final merge commit still has both histories as parents, so GitHub can be updated by fast-forward. The later TDD tasks port the relevant remote OCR/viewer behaviors one at a time, with tests proving each port.

- [ ] **Step 3: Verify the current `/sph/` architecture remains the merge tree**

The retained video entrypoints must remain:

```text
scripts/process-video-channels.js
scripts/lib/video-channel-batch.js
scripts/lib/video-channel-pipeline.js
scripts/lib/video-channel-resolver.js
scripts/lib/video-channel-runtime.js
```

Verify:

```bash
git status --short
git diff --exit-code HEAD -- wechat-filehelper-macos-ingest
rg -n 'process-videos|system-audio-capture|video-capture' wechat-filehelper-macos-ingest
```

Expected: the tracked tree has no content diff from the pre-merge current branch, and `rg` has no code or package-script matches.

- [ ] **Step 4: Run the merged baseline**

Run:

```bash
cd wechat-filehelper-macos-ingest
npm test
```

Expected: all tests pass. If an imported legacy test contradicts the approved `/sph/` background architecture, remove or rewrite that test before proceeding; do not reintroduce the foreground audio workflow.

- [ ] **Step 5: Commit the merge**

Run:

```bash
git add -A
git diff --cached --check
git commit -m "merge: reconcile legacy FileHelper history"
```

Expected: a two-parent merge commit whose first-parent tree still uses the `video-channel-*` implementation.

### Task 2: Fix direct URL recovery and conservative pre-click dedupe

**Files:**
- Modify: `wechat-filehelper-macos-ingest/scripts/lib/ui.js` around `inferShareCardItemsFromOcr`, `extractOcrUrlEntries`, and `buildArticleFingerprintAliases`
- Test: `wechat-filehelper-macos-ingest/test/ui.test.js` in `buildUiSnapshot` and `scanUiLinks` suites

- [ ] **Step 1: Add failing direct-URL tests**

Add tests equivalent to:

```js
it("promotes a single OCR URL line even when its left edge is before the old right-pane boundary", () => {
  const snapshot = buildUiSnapshot({
    clipboardSnapshot: { rawText: "", blocks: [], items: [], messages: [], stats: { skipped_by_rule: {} } },
    windowBounds: { x: 0, y: 0, width: 1470, height: 956 },
    ocrResult: {
      width: 1470,
      height: 956,
      lines: [
        { text: "文件传输助手", x: 800, y: 30, width: 180, height: 30 },
        { text: "https://example.org/game-rankings/", x: 779, y: 410, width: 560, height: 24 },
      ],
    },
  });

  assert.deepEqual(snapshot.blocks.flatMap((block) => block.directUrls), [
    "https://example.org/game-rankings/",
  ]);
});

it("reconstructs a wrapped OCR URL beginning on one line and continuing on the next", () => {
  const snapshot = buildUiSnapshot({
    clipboardSnapshot: { rawText: "", blocks: [], items: [], messages: [], stats: { skipped_by_rule: {} } },
    windowBounds: { x: 0, y: 0, width: 1470, height: 956 },
    ocrResult: {
      width: 1470,
      height: 956,
      lines: [
        { text: "文件传输助手", x: 800, y: 30, width: 180, height: 30 },
        { text: "https://example.org/press/How-is-theory-", x: 779, y: 410, width: 600, height: 24 },
        { text: "translated-to-technology-design", x: 779, y: 438, width: 500, height: 24 },
      ],
    },
  });

  assert.deepEqual(snapshot.blocks.flatMap((block) => block.directUrls), [
    "https://example.org/press/How-is-theory-translated-to-technology-design",
  ]);
});
```

- [ ] **Step 2: Run the two tests and verify RED**

Run:

```bash
node --test --test-name-pattern='single OCR URL|wrapped OCR URL' test/ui.test.js
```

Expected: both tests fail because the current right boundary and `cluster.length < 2` gate discard these inputs.

- [ ] **Step 3: Implement URL-specific page-line reconstruction**

In `ui.js`, keep article-card geometry strict but scan URL anchors separately. Add a helper with this contract:

```js
export function extractPageOcrUrlEntries(ocrLines, { imageWidth = 0, imageHeight = 0 } = {}) {
  const contentTop = imageHeight * OCR_TOP_CONTENT_RATIO;
  const chatLeft = imageWidth * 0.48;
  const lines = (ocrLines ?? [])
    .filter((line) => line?.text && line.y >= contentTop && line.x >= chatLeft)
    .sort((left, right) => left.y - right.y || left.x - right.x);
  const candidates = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!/https?:\/\//i.test(lines[index].text)) continue;
    let joined = String(lines[index].text).trim();
    candidates.push(joined);
    for (let offset = 1; offset <= 3 && index + offset < lines.length; offset += 1) {
      const previous = lines[index + offset - 1];
      const next = lines[index + offset];
      const gap = next.y - (previous.y + previous.height);
      if (gap > Math.max(previous.height, next.height) * 1.4) break;
      if (Math.abs(next.x - lines[index].x) > imageWidth * 0.12) break;
      if (/https?:\/\//i.test(next.text)) break;
      joined += String(next.text).trim();
      candidates.push(joined);
    }
  }

  return extractOcrUrlEntries(candidates);
}
```

Merge these entries into the OCR fallback blocks before `inferShareCardItemsFromOcr` filters card clusters. Reuse `normalizeDirectUrlEntries` so truncated prefixes remain suppressed and ambiguous OCR remains `uncertain`.

- [ ] **Step 4: Run the URL tests and verify GREEN**

Run:

```bash
node --test --test-name-pattern='single OCR URL|wrapped OCR URL' test/ui.test.js
```

Expected: both pass.

- [ ] **Step 5: Add failing dedupe tests for shared prefixes and footers**

Add `scanUiLinks` tests that feed consecutive pages containing:

```js
const first = { shareCardTitle: "众神的权柄（上）", rawText: "众神的权柄（上）\n共同来源" };
const second = { shareCardTitle: "众神的权柄（下）", rawText: "众神的权柄（下）\n共同来源" };
```

and a second pair with different titles but the same footer. Stub `extractShareCardUrlFn` to return a different URL for every call. Assert `share_cards_attempted === 2`, `records.length === 2`, and `duplicate_skipped === 0` for each pair.

- [ ] **Step 6: Run the dedupe tests and verify RED**

Run:

```bash
node --test --test-name-pattern='shared prefixes|shared footer' test/ui.test.js
```

Expected: at least one test fails because a 10-character or footer alias matches.

- [ ] **Step 7: Replace weak aliases with a full primary identity**

Change `buildArticleFingerprintAliases` to return one pre-click identity only:

```js
function buildArticleFingerprintAliases(block) {
  const timestamp = normalizeComparableText(block?.timestampText ?? "");
  const rawLines = Array.isArray(block?.rawLines)
    ? block.rawLines
    : String(block?.rawText ?? "").split(/\r?\n/);
  const title = normalizeArticleSignatureLine(block?.shareCardTitle ?? "");
  const primary = title || rawLines.map(normalizeArticleSignatureLine).find(Boolean) || "";
  const identity = [timestamp, primary].filter(Boolean).join("|");
  return identity ? [identity] : [];
}
```

Do not add prefix, source-footer, or sliding-window aliases. URL canonicalization remains the post-extraction strong dedupe.

- [ ] **Step 8: Run UI tests and commit**

Run:

```bash
node --test test/ui.test.js
git diff --check
```

Expected: all UI tests pass. Update any old test that required fuzzy pre-click dedupe to assert the safer behavior: a repeated extraction may occur, but the canonical URL is recorded once.

Commit:

```bash
git add wechat-filehelper-macos-ingest/scripts/lib/ui.js wechat-filehelper-macos-ingest/test/ui.test.js
git commit -m "fix: recover direct URLs without weak card dedupe"
```

### Task 3: Make article/video viewer outcomes explicit

**Files:**
- Modify: `wechat-filehelper-macos-ingest/scripts/lib/ui.js` around `waitForViewerReady`, `extractShareCardUrl`, and `scanUiLinks`
- Modify: `wechat-filehelper-macos-ingest/scripts/lib/scan.js` where scan result arrays are persisted
- Test: `wechat-filehelper-macos-ingest/test/ui.test.js`
- Test: `wechat-filehelper-macos-ingest/test/scan-flow.test.js`

- [ ] **Step 1: Add a failing rich-media viewer test**

Add a test where `detectViewerContextFn` returns a new stable window whose OCR has a partial title but no four-line article shell, `waitForViewerReadyFn` returns that context, and `openViewerMenuFn` exposes Copy Link. Assert the menu is called and the result is `ok` with the copied article URL.

```js
assert.equal(openedMenu, true);
assert.equal(result.status, "ok");
assert.equal(result.url, "https://mp.weixin.qq.com/s/rich-media-test");
```

- [ ] **Step 2: Add failing unresolved-item tests**

In `scanUiLinks`, make `extractShareCardUrlFn` return:

```js
{
  status: "failed",
  reason: "video_channel_copy_link_not_found",
  failureStage: "viewer_copy",
  timings: {},
}
```

Assert the scan returns one `unresolvedRecord` with:

```js
{
  record_type: "unresolved_item",
  content_type: "video_channel",
  failure_stage: "viewer_copy",
  error_code: "video_channel_copy_link_not_found",
  attempt_count: 1,
}
```

Add the same assertion for an article `ocr_candidate_missing` failure.

- [ ] **Step 3: Run the new tests and verify RED**

Run:

```bash
node --test --test-name-pattern='rich-media viewer|unresolved-item' test/ui.test.js
```

Expected: rich-media readiness or unresolved persistence assertions fail.

- [ ] **Step 4: Relax the menu gate but keep loading detection**

In `waitForViewerReady`, return once the viewer is stable and `viewerLooksLoading(ocrResult)` is false. Keep `ocrAnalysis` on the context for diagnostics. In `extractShareCardUrl`, attempt the article menu even when `ocrAnalysis.matched` is false; only a still-loading viewer may postpone the menu until timeout.

Normalize failure output:

```js
return {
  status: "failed",
  reason,
  failureStage: reason === "copy_link_failed" ? "viewer_copy" : "viewer_menu",
  viewerKind: videoChannelViewer ? "video_channel" : "article",
  timings,
};
```

- [ ] **Step 5: Persist unresolved records from every actionable failure**

Add `const unresolvedRecords = []` in `scanUiLinks` and a helper:

```js
function pushUnresolvedRecord({ block, candidate, messageTime, contentType, failureStage, errorCode, attemptCount = 1 }) {
  const messageTimeIso = (messageTime ?? referenceNow).toISOString();
  const basis = normalizeComparableText(block?.shareCardTitle ?? block?.rawText ?? candidate?.title ?? "unknown");
  unresolvedRecords.push({
    captured_at: capturedAt.toISOString(),
    message_time: messageTimeIso,
    chat_name: FILE_HELPER_CHAT_NAME,
    record_type: "unresolved_item",
    content_type: contentType,
    title: block?.shareCardTitle ?? candidate?.title ?? "",
    raw_text: block?.rawText ?? candidate?.rawText ?? "",
    failure_stage: failureStage,
    error_code: errorCode,
    attempt_count: attemptCount,
    page_index: scrollCount,
    click_x: candidate?.clickX ?? null,
    click_y: candidate?.clickY ?? null,
    dedupe_key: dedupeKey(FILE_HELPER_CHAT_NAME, messageTimeIso, `unresolved:${contentType}:${basis}:${errorCode}`),
    capture_session_id: sessionId,
    source: "ui",
  });
}
```

Call it for candidate generation failures and extractor failures. Return `unresolvedRecords` from `scanUiLinks`.

- [ ] **Step 6: Persist unresolved records in `runScan`**

In `scan.js`, read `scanResult.unresolvedRecords ?? []`, include them in `mergeRecords`, expose them in the return object, and add `unresolved_items_total` to the manifest. Do not put them in `skippedRecords`.

- [ ] **Step 7: Run viewer and scan-flow tests**

Run:

```bash
node --test test/ui.test.js test/scan-flow.test.js
```

Expected: all pass, including the existing `/sph/` success tests.

- [ ] **Step 8: Commit**

```bash
git add wechat-filehelper-macos-ingest/scripts/lib/ui.js wechat-filehelper-macos-ingest/scripts/lib/scan.js wechat-filehelper-macos-ingest/test/ui.test.js wechat-filehelper-macos-ingest/test/scan-flow.test.js
git commit -m "fix: preserve rich-media and viewer failures"
```

### Task 4: Add deterministic image OCR records and Obsidian publication

**Files:**
- Create: `wechat-filehelper-macos-ingest/scripts/lib/image-content.js`
- Create: `wechat-filehelper-macos-ingest/test/image-content.test.js`
- Reuse: `wechat-filehelper-macos-ingest/scripts/lib/video-channel-runtime.js` export `resolveObsidianClippingsDir`

- [ ] **Step 1: Write failing pure-record tests**

Create `test/image-content.test.js` with tests for this public API:

```js
import {
  ImageContentError,
  createImageContentRecord,
  publishImageContentRecord,
  renderImageContentNote,
} from "../scripts/lib/image-content.js";
```

Test a high-confidence record:

```js
const record = createImageContentRecord({
  capturedAt: "2026-08-29T00:00:00.000Z",
  messageTime: "2026-08-28T15:45:00.000Z",
  sessionId: "session-image",
  lines: [
    { text: "图片中的标题", confidence: 0.96 },
    { text: "图片中的正文内容", confidence: 0.88 },
  ],
});
assert.equal(record.record_type, "content");
assert.equal(record.content_type, "image_ocr");
assert.equal(record.pkm_status, "pending");
assert.equal(record.ocr_confidence, 0.92);
assert.match(record.content_hash, /^[a-f0-9]{64}$/);
```

Test that confidence below `0.72` produces `pkm_status: "needs_review"`, and that no text throws `ImageContentError` with `code === "image_ocr_empty"` instead of returning an empty record.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test test/image-content.test.js
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement record construction and note rendering**

Create `image-content.js` with:

```js
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { FILE_HELPER_CHAT_NAME } from "./chat.js";
import { dedupeKey } from "./common.js";
import { resolveObsidianClippingsDir } from "./video-channel-runtime.js";

const REVIEW_THRESHOLD = 0.72;

export class ImageContentError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ImageContentError";
    this.code = code;
    this.details = details;
  }
}

export function createImageContentRecord({ capturedAt, messageTime, sessionId, lines, artifactPath = null }) {
  const usable = (lines ?? [])
    .map((line) => ({ text: String(line?.text ?? "").trim(), confidence: Number(line?.confidence ?? 0) }))
    .filter((line) => line.text);
  if (usable.length === 0) throw new ImageContentError("image_ocr_empty", "Image OCR returned no text");

  const contentText = usable.map((line) => line.text).join("\n");
  const normalized = contentText.normalize("NFKC").replace(/\s+/g, " ").trim();
  const contentHash = crypto.createHash("sha256").update(normalized).digest("hex");
  const confidence = Number((usable.reduce((sum, line) => sum + line.confidence, 0) / usable.length).toFixed(4));
  const capturedIso = new Date(capturedAt).toISOString();
  const messageIso = new Date(messageTime).toISOString();

  return {
    captured_at: capturedIso,
    message_time: messageIso,
    chat_name: FILE_HELPER_CHAT_NAME,
    record_type: "content",
    content_type: "image_ocr",
    title: usable[0].text.slice(0, 80),
    content_text: contentText,
    ocr_confidence: confidence,
    content_hash: contentHash,
    pkm_status: confidence < REVIEW_THRESHOLD ? "needs_review" : "pending",
    artifact_path: artifactPath,
    dedupe_key: dedupeKey(FILE_HELPER_CHAT_NAME, messageIso, `image:${contentHash}`),
    capture_session_id: sessionId,
    source: "ui",
  };
}
```

`renderImageContentNote(record)` must emit YAML with `source: wechat_filehelper`, `content_type: image_ocr`, message time, OCR confidence, and `review_required`, followed by `## 图片文字` and the exact OCR text.

- [ ] **Step 4: Add failing publication tests**

Use a temporary directory and inject `resolveObsidianDirFn`. Assert `publishImageContentRecord` writes a Markdown file, reads it back, verifies both `## 图片文字` and non-empty `content_text`, returns `note_path`, and changes high-confidence `pending` to `written` while preserving `needs_review` for low confidence.

Add a fake `fsImpl.readFile` that returns an empty body and assert an `ImageContentError` with `code === "image_note_verification_failed"`.

- [ ] **Step 5: Implement atomic, verified publication**

Implement:

```js
export async function publishImageContentRecord(record, {
  obsidianDir = null,
  resolveObsidianDirFn = resolveObsidianClippingsDir,
  fsImpl = fs,
} = {}) {
  if (!record?.content_text?.trim()) throw new ImageContentError("image_ocr_empty", "Image record has no OCR text");
  const targetDir = obsidianDir ?? await resolveObsidianDirFn();
  if (!targetDir) throw new ImageContentError("obsidian_target_unavailable", "No proven Obsidian Clippings directory");
  await fsImpl.mkdir(targetDir, { recursive: true });

  const base = sanitizeFileName(record.title || `微信图片 ${record.message_time}`).slice(0, 80) || "微信图片";
  const notePath = await reserveUniqueNotePath(targetDir, base, fsImpl);
  const tempPath = `${notePath}.part`;
  const markdown = renderImageContentNote(record);
  await fsImpl.writeFile(tempPath, markdown, "utf8");
  await fsImpl.rename(tempPath, notePath);
  const verified = await fsImpl.readFile(notePath, "utf8");
  if (!verified.includes("## 图片文字") || !verified.includes(record.content_text.trim())) {
    throw new ImageContentError("image_note_verification_failed", "Image note content verification failed", { notePath });
  }
  return { ...record, pkm_status: record.pkm_status === "needs_review" ? "needs_review" : "written", note_path: notePath };
}
```

Define `sanitizeFileName` and `reserveUniqueNotePath` in the same module; reserve with `fs.open(path, "wx")`, close the handle, and try suffixes `-2` through `-100`. On exhaustion throw `image_note_path_exhausted`.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
node --test test/image-content.test.js
git diff --check
```

Expected: all image-content tests pass.

Commit:

```bash
git add wechat-filehelper-macos-ingest/scripts/lib/image-content.js wechat-filehelper-macos-ingest/test/image-content.test.js
git commit -m "feat: publish image OCR content to Obsidian"
```

### Task 5: Route confirmed image viewers through scan, query, and manifest accounting

**Files:**
- Modify: `wechat-filehelper-macos-ingest/scripts/lib/ui.js`
- Modify: `wechat-filehelper-macos-ingest/scripts/lib/scan.js`
- Modify: `wechat-filehelper-macos-ingest/scripts/lib/query.js`
- Modify: `wechat-filehelper-macos-ingest/scripts/collect-links.js`
- Test: `wechat-filehelper-macos-ingest/test/ui.test.js`
- Test: `wechat-filehelper-macos-ingest/test/scan-flow.test.js`
- Test: `wechat-filehelper-macos-ingest/test/query-links.test.js`

- [ ] **Step 1: Add failing image-viewer confirmation tests**

Build an OCR fallback block that is currently classified `plain_text_block` or `weak_ocr_card`. Inject `extractImageContentFn` and assert:

```js
assert.equal(imageExtractorCalls, 1);
assert.equal(result.contentRecords.length, 1);
assert.equal(result.contentRecords[0].content_type, "image_ocr");
assert.equal(result.skippedRecords.length, 0);
```

Add a second case where the click does not open a new/front viewer. Assert no image content is created and an explicit unresolved item has `error_code: "image_viewer_not_opened"`; a normal clipboard plain-text block must never become an image candidate.

- [ ] **Step 2: Add failing query tests**

Write an index fixture containing a `content/image_ocr` record and an `unresolved_item`. Assert JSON output has:

```js
{
  image_contents: [imageRecord],
  unresolved_items: [unresolvedRecord],
  records: [],
}
```

Assert Markdown contains `## 图片 OCR 内容` and `## 未解决项`, while the article-link section stays empty.

- [ ] **Step 3: Add failing manifest-accounting test**

Stub `scanUiLinksFn` to return one link, one content record, one unresolved item, and stats:

```js
type_outcomes: {
  article: { seen: 1, resolved: 1, duplicate: 0, unresolved: 0, failed: 0, skipped_by_policy: 0 },
  image: { seen: 2, resolved: 1, duplicate: 0, unresolved: 1, failed: 0, skipped_by_policy: 0 },
}
```

Assert both arrays enter the JSONL index and `manifest.type_outcomes.image.seen === 2`. Add a mismatch case and assert `runScan` throws `Type outcome accounting mismatch for image` before printing success.

- [ ] **Step 4: Run the new tests and verify RED**

Run:

```bash
node --test --test-name-pattern='image viewer|图片 OCR|type outcome' test/ui.test.js test/query-links.test.js test/scan-flow.test.js
```

Expected: failures for missing image routing, result groups, and accounting.

- [ ] **Step 5: Add typed image candidates and extractor injection**

In `ui.js`:

1. Preserve OCR clusters currently labeled `plain_text_block`, `weak_ocr_card`, or an explicit image label as `block.contentType = "image_candidate"` instead of immediately writing `skipped_card`.
2. Create a click candidate from the cluster rectangle.
3. Add `extractImageContentFn = extractImageContentFromViewer` to `scanUiLinks` dependencies.
4. Process direct URLs first, article/video cards second, and image candidates third.
5. Only `extractImageContentFromViewer` may confirm `content_type=image_ocr`.

The extractor must:

```js
async function extractImageContentFromViewer(candidate, options, deps) {
  const beforeWindows = deps.getWeChatWindowsFn();
  deps.clickAtPointFn(candidate.clickX, candidate.clickY);
  const viewer = await deps.detectViewerContextFn(beforeWindows, candidate, options, deps);
  if (!viewer || viewer.ocrAnalysis?.matched || isVideoChannelViewer(viewer)) {
    return { status: "failed", failureStage: "viewer_open", reason: "image_viewer_not_opened" };
  }
  const imagePath = path.join(options.artifactDir ?? os.tmpdir(), `image-${Date.now()}.png`);
  deps.captureRectScreenshotFn(viewer.screenRect, imagePath);
  const ocr = await deps.recognizeTextFromImageFn(imagePath);
  const record = createImageContentRecord({
    capturedAt: options.capturedAt,
    messageTime: options.messageTime,
    sessionId: options.sessionId,
    lines: ocr.lines,
    artifactPath: imagePath,
  });
  const published = await deps.publishImageContentRecordFn(record);
  const close = await closeAndVerifyViewer(beforeWindows, options, deps);
  if (!close.recovered) return { status: "failed", failureStage: "viewer_close", reason: "viewer_recovery_failed" };
  if (published.note_path) await fs.rm(imagePath, { force: true });
  return { status: "ok", record: published };
}
```

Use existing close/recovery primitives instead of duplicating AppleScript. Convert thrown `ImageContentError` into `failureStage: "image_ocr"` or `"pkm_publish"` with its non-empty `code`, and retain the artifact on failure.

- [ ] **Step 6: Add per-type outcome helpers**

Initialize:

```js
const TYPE_NAMES = ["direct_url", "article", "video_channel", "image"];
const OUTCOME_NAMES = ["resolved", "duplicate", "unresolved", "failed", "skipped_by_policy"];

function createTypeOutcomes() {
  return Object.fromEntries(TYPE_NAMES.map((type) => [type, {
    seen: 0,
    resolved: 0,
    duplicate: 0,
    unresolved: 0,
    failed: 0,
    skipped_by_policy: 0,
  }]));
}
```

Increment `seen` once per logical block and exactly one final outcome. Add `validateTypeOutcomes` in `scan.js`:

```js
export function validateTypeOutcomes(typeOutcomes = {}) {
  for (const [type, counts] of Object.entries(typeOutcomes)) {
    const final = ["resolved", "duplicate", "unresolved", "failed", "skipped_by_policy"]
      .reduce((sum, key) => sum + Number(counts?.[key] ?? 0), 0);
    if (Number(counts?.seen ?? 0) !== final) {
      throw new Error(`Type outcome accounting mismatch for ${type}: seen=${counts?.seen ?? 0}, final=${final}`);
    }
  }
}
```

- [ ] **Step 7: Persist and query the new record groups**

In `scan.js`, persist `contentRecords` and `unresolvedRecords` with the other arrays, validate `stats.type_outcomes`, and copy it to the manifest.

In `query.js`, route records in this order:

```js
if (record?.record_type === "content" && record?.content_type === "image_ocr") imageContents.push(record);
else if (record?.record_type === "unresolved_item") unresolvedItems.push(record);
else if (record?.record_type === "skipped_card") skippedCards.push(record);
else if (record?.record_type === "uncertain_link") uncertainLinks.push(record);
else if (isVideoChannelShareUrl(record?.url)) videoChannels.push(record);
else if (record?.url && !shouldSkipUrl(record.url)) records.push(record);
```

Return camelCase arrays in JavaScript and snake_case keys in JSON: `image_contents`, `unresolved_items`.

Update `collect-links.js` result-presence checks so existing image or unresolved records prevent the misleading “no results” message.

- [ ] **Step 8: Run focused and full tests**

Run:

```bash
node --test test/image-content.test.js test/ui.test.js test/query-links.test.js test/scan-flow.test.js
npm test
git diff --check
```

Expected: all tests pass and the full count is greater than the 128-test baseline.

- [ ] **Step 9: Commit**

```bash
git add wechat-filehelper-macos-ingest/scripts/lib/ui.js wechat-filehelper-macos-ingest/scripts/lib/scan.js wechat-filehelper-macos-ingest/scripts/lib/query.js wechat-filehelper-macos-ingest/scripts/collect-links.js wechat-filehelper-macos-ingest/test/ui.test.js wechat-filehelper-macos-ingest/test/scan-flow.test.js wechat-filehelper-macos-ingest/test/query-links.test.js
git commit -m "feat: route image OCR through PKM and audit outcomes"
```

### Task 6: Document and replay the five regressions against local evidence

**Files:**
- Modify: `wechat-filehelper-macos-ingest/SKILL.md`
- Create only if needed for sanitized geometry: `wechat-filehelper-macos-ingest/test/fixtures/mixed-content-ocr.json`
- Do not add: files from either repository's `local/` directory

- [ ] **Step 1: Update the operator contract**

Document:

- `records` contains article/direct URLs only.
- `video_channels` contains `/sph/` records for the background video processor.
- `image_contents` contains OCR text, confidence, note path, and review status.
- `unresolved_items` contains actionable failures with stage and code.
- Image crops are removed after verified note publication and retained only on failure.
- A successful run requires manifest accounting plus article/video/image PKM verification; one successful branch cannot stand in for another.

- [ ] **Step 2: Run offline replay against the private 2026-08-28 artifacts**

Use a temporary, untracked replay script or a direct `node --input-type=module` command to load OCR JSON from:

```text
/Users/haodong/Documents/GitHub/AI-Clippings/wechat-filehelper-macos-ingest/local/runs/2026-08-28T15-42-04/artifacts/
```

Call the exported pure OCR/snapshot helpers. Verify at minimum:

- the known single-line direct URL appears in `directUrlEntries`;
- the known wrapped direct URL reconstructs to one valid URL;
- cards with common sources and distinct titles receive distinct pre-click identities;
- no private artifact is copied into the worktree.

Expected: the replay prints four explicit booleans/counts and exits non-zero if any assertion fails.

- [ ] **Step 3: Run all static and automated checks**

Run:

```bash
npm test
git diff --check
git status --short
```

Expected: tests pass; status includes only the intended documentation change.

- [ ] **Step 4: Commit**

```bash
git add wechat-filehelper-macos-ingest/SKILL.md
git commit -m "docs: define mixed-content PKM routing"
```

### Task 7: Project records, final verification, push, and local synchronization

**Files:**
- Modify: `ProjectInfo/ProjectProgress.md`
- Append/create: `ProjectInfo/dialogues/2026-0829.md`
- Append/create: `ProjectInfo/sessions/2026-0828-wechat-mixed-content-scan-diagnosis.md`

- [ ] **Step 1: Run verification-before-completion checks**

Run:

```bash
cd wechat-filehelper-macos-ingest
npm test
node --test test/ui.test.js test/image-content.test.js test/query-links.test.js test/scan-flow.test.js
cd ..
git diff --check
git status --short
git log --oneline --decorate -12
```

Expected: all tests pass, no whitespace errors, and only intentional ProjectInfo changes remain uncommitted.

- [ ] **Step 2: Update the required project records using system time**

Run `date '+%Y-%m-%d %H:%M:%S %z'` and use that timestamp. Update `ProjectProgress.md` as a current snapshot. Append one raw-dialogue section and one session-summary section containing conclusion, risks, next step, commits, test counts, offline replay result, and whether a live WeChat scan was performed. Do not record secrets or private OCR text.

- [ ] **Step 3: Commit only the intended ProjectInfo files**

```bash
git add ProjectInfo/ProjectProgress.md ProjectInfo/dialogues/2026-0829.md ProjectInfo/sessions/2026-0828-wechat-mixed-content-scan-diagnosis.md
git diff --cached --check
git commit -m "docs: record mixed-content ingest fixes"
```

- [ ] **Step 4: Verify the branch contains both histories and push without force**

Run:

```bash
git merge-base --is-ancestor origin/main HEAD
git push origin HEAD:main
git ls-remote origin refs/heads/main
```

Expected: ancestor check exits 0; push is a fast-forward; the remote hash equals `git rev-parse HEAD`.

- [ ] **Step 5: Fast-forward the historical GitHub checkout**

In `/Users/haodong/Documents/GitHub/AI-Clippings`, first run:

```bash
git status --short --branch
git fetch origin main
git merge --ff-only origin/main
```

Expected: tracked files fast-forward; `.DS_Store` and the existing untracked package lock remain untouched.

- [ ] **Step 6: Fast-forward the source-of-truth checkout without overwriting unrelated dirty files**

In `/Users/haodong/Documents/AI/Codex/Clippings`, run `git status --short --branch` and inspect overlap with the incoming file list. If no dirty path overlaps the incoming commits, run:

```bash
git merge --ff-only codex/wechat-mixed-content-fixes
```

If an untracked/dirty ProjectInfo path would be overwritten, merge its non-secret content into the feature branch with `apply_patch`, commit it, push the additional fast-forward commit, then retry. Do not stash, reset, or discard user changes.

- [ ] **Step 7: Prove all three tracked versions agree**

Run:

```bash
git -C /Users/haodong/Documents/AI/Codex/Clippings rev-parse HEAD
git -C /Users/haodong/Documents/GitHub/AI-Clippings rev-parse HEAD
git ls-remote https://github.com/Medill-East/AI-Clippings.git refs/heads/main
git -C /Users/haodong/Documents/GitHub/AI-Clippings diff --exit-code HEAD -- wechat-filehelper-macos-ingest
```

Expected: the three hashes are identical and the tracked macOS ingest tree has no local diff.
