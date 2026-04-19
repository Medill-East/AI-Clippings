import fs from "node:fs/promises";
import path from "node:path";

import { waitForUserReady, navigateToFileHelper, scanClipboardLinks } from "./chat.js";
import {
  formatCstDateTime,
  mergeRecords,
  newRunTimestamp,
  parseUserDateTimeInput,
  readJsonlines,
  writeJsonlines,
} from "./common.js";
import { probeWeChatStore, scanStoreLinks } from "./store.js";
import { probeUiEnvironment, scanUiLinks } from "./ui.js";

export function parseScanArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    since: null,
    until: null,
    source: "auto",
    maxScrolls: 50,
    maxCandidates: Number.POSITIVE_INFINITY,
    reindex: false,
    debug: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--since":
        opts.since = args[++i];
        break;
      case "--until":
        opts.until = args[++i];
        break;
      case "--source":
        opts.source = args[++i];
        if (!["auto", "ui", "store", "clipboard"].includes(opts.source)) {
          throw new Error(`Unknown source: ${opts.source}. Use auto, ui, store, or clipboard.`);
        }
        break;
      case "--max-scrolls":
        opts.maxScrolls = Math.min(200, Math.max(1, parseInt(args[++i], 10)));
        break;
      case "--max-candidates":
        opts.maxCandidates = Math.min(500, Math.max(1, parseInt(args[++i], 10)));
        break;
      case "--reindex":
        opts.reindex = true;
        break;
      case "--debug":
        opts.debug = true;
        break;
      default:
        throw new Error(`Unknown argument: ${args[i]}`);
    }
  }

  if (!opts.since || !opts.until) {
    throw new Error("--since and --until are required.");
  }

  const since = parseUserDateTimeInput(opts.since);
  const until = parseUserDateTimeInput(opts.until);
  if (!since || !until) {
    throw new Error("--since and --until must be valid ISO 8601 date-time strings.");
  }
  if (since > until) {
    throw new Error("--since must be before --until.");
  }

  return { ...opts, since, until };
}

export function formatScanUsage() {
  return `
Usage:
  node scripts/scan-links.js --since <ISO8601> --until <ISO8601> [options]

Options:
  --since <ISO8601>     Start time (inclusive), China Standard Time by default, e.g. 2026-03-28T15:00:00 or 2026-03-28T15:00:00+08:00
  --until <ISO8601>     End time (inclusive), China Standard Time by default, e.g. 2026-03-28T23:59:59 or 2026-03-28T23:59:59+08:00
  --source <mode>       auto | ui | store | clipboard (default auto)
  --max-scrolls N       Maximum upward scrolls for clipboard fallback (default 50, max 200)
  --max-candidates N    Maximum share-card extraction attempts in UI mode (default unlimited)
  --reindex             Clear existing index before scan
  --debug               Print verbose debug output
`;
}

export async function runScan(
  opts,
  {
    skillRoot,
    fsImpl = fs,
    probeWeChatStoreFn = probeWeChatStore,
    probeUiEnvironmentFn = probeUiEnvironment,
    waitForUserReadyFn = waitForUserReady,
    navigateToFileHelperFn = navigateToFileHelper,
    scanClipboardLinksFn = scanClipboardLinks,
    scanStoreLinksFn = scanStoreLinks,
    scanUiLinksFn = scanUiLinks,
  } = {}
) {
  const indexPath = path.join(skillRoot, "local/index/links.jsonl");
  const runTs = newRunTimestamp();
  const runDir = path.join(skillRoot, "local/runs", runTs);
  const artifactDir = path.join(runDir, "artifacts");
  await fsImpl.mkdir(runDir, { recursive: true });

  console.log("WeChat FileHelper macOS Ingest — Scan");
  console.log(`Since : ${formatCstDateTime(opts.since)}`);
  console.log(`Until : ${formatCstDateTime(opts.until)}`);
  console.log(`Source: ${opts.source}`);
  console.log(`Max scrolls: ${opts.maxScrolls}`);
  if (opts.reindex) console.log("Mode  : REINDEX (clearing existing index)");
  console.log("-".repeat(50));

  if (opts.reindex) {
    await fsImpl.rm(indexPath, { force: true });
    console.log("Existing index cleared.");
  }

  let sourceSelected = opts.source;
  let fallbackReason = null;
  let storeProbe = { store_probe_status: "not_checked", reasons: [] };
  let uiProbe = { ui_probe_status: "not_checked", reasons: [] };

  let scanResult;
  if (opts.source === "store") {
    console.log("Probing local WeChat store...");
    storeProbe = await probeWeChatStoreFn({ debug: opts.debug });
    sourceSelected = "store";
    if (storeProbe.store_probe_status !== "readable") {
      throw new Error(
        `Store source requested but unavailable: ${storeProbe.store_probe_status}. ${storeProbe.reasons.join(" ")}`
      );
    }

    console.log("Scanning from local WeChat store...");
    scanResult = await scanStoreLinksFn({
      probe: storeProbe,
      since: opts.since,
      until: opts.until,
      debug: opts.debug,
    });
  } else {
    await waitForUserReadyFn();
    console.log("Activating WeChat window...");
    await navigateToFileHelperFn(opts.debug);

    if (opts.source === "auto" || opts.source === "ui") {
      console.log("Probing macOS UI scan readiness...");
      await fsImpl.mkdir(artifactDir, { recursive: true });
      uiProbe = await probeUiEnvironmentFn({
        requireChatReady: true,
        debug: opts.debug,
        artifactDir,
        label: "ui-probe",
      });
    }

    if (opts.source === "auto") {
      if (uiProbe.ui_probe_status === "ready") {
        sourceSelected = "ui";
      } else {
        sourceSelected = "clipboard";
        fallbackReason = `ui unavailable (${uiProbe.ui_probe_status})`;
      }
    } else if (opts.source === "ui" && uiProbe.ui_probe_status !== "ready") {
      throw new Error(
        `UI source requested but unavailable: ${uiProbe.ui_probe_status}. ${uiProbe.reasons.join(" ")}`
      );
    } else if (opts.source === "clipboard") {
      sourceSelected = "clipboard";
    }

    if (sourceSelected === "ui") {
      console.log("Scanning from UI-first single-article flow...");
      scanResult = await scanUiLinksFn(opts.since, opts.until, opts.maxScrolls, opts.debug, {
        runDir,
        maxCandidates: opts.maxCandidates,
        waitForUserReadyFn: async () => {},
        navigateToFileHelperFn: async () => {},
      });
    } else {
      console.log("Using clipboard fallback.");
      console.log("Scanning visible messages from clipboard fallback...");
      scanResult = await scanClipboardLinksFn(
        opts.since,
        opts.until,
        opts.maxScrolls,
        opts.debug
      );
    }
  }

  const newRecords = scanResult.records;
  const uncertainRecords = scanResult.uncertainRecords ?? [];
  const pendingRecords = scanResult.pendingRecords ?? [];
  const skippedRecords = scanResult.skippedRecords ?? [];
  console.log(`Collected ${newRecords.length} link(s) from this scan.`);
  if (uncertainRecords.length > 0) {
    console.log(`Recorded ${uncertainRecords.length} uncertain external link(s).`);
  }
  if (pendingRecords.length > 0) {
    console.log(`Recorded ${pendingRecords.length} pending item(s).`);
  }
  if (skippedRecords.length > 0) {
    console.log(`Recorded ${skippedRecords.length} skipped card(s).`);
  }

  const existing = await readJsonlines(indexPath);
  const merged = mergeRecords(existing, [...newRecords, ...uncertainRecords, ...pendingRecords, ...skippedRecords]);
  const addedCount = merged.length - existing.length;
  await writeJsonlines(indexPath, merged);
  console.log(`Added ${addedCount} new record(s) to index (${merged.length} total).`);

  const manifest = {
    run_at: new Date().toISOString(),
    since: opts.since.toISOString(),
    until: opts.until.toISOString(),
    source_requested: opts.source,
    source_selected: sourceSelected,
    ui_probe_status: uiProbe.ui_probe_status,
    store_probe_status: storeProbe.store_probe_status,
    fallback_reason: fallbackReason,
    max_scrolls: opts.maxScrolls,
    max_candidates: Number.isFinite(opts.maxCandidates) ? opts.maxCandidates : null,
    reindex: opts.reindex,
    collected: newRecords.length,
    uncertain_links_total: uncertainRecords.length,
    pending_items_total: pendingRecords.length,
    skipped_cards_total: skippedRecords.length,
    added_to_index: addedCount,
    index_total: merged.length,
    share_cards_seen: scanResult.stats.share_cards_seen ?? 0,
    share_cards_attempted: scanResult.stats.share_cards_attempted ?? 0,
    share_cards_resolved: scanResult.stats.share_cards_resolved ?? 0,
    share_cards_unresolved: scanResult.stats.share_cards_unresolved ?? 0,
    browser_fallback_used: scanResult.stats.browser_fallback_used ?? 0,
    clipboard_reads: scanResult.stats.clipboard_reads ?? 0,
    ocr_only_pages: scanResult.stats.ocr_only_pages ?? 0,
    duplicate_skipped: scanResult.stats.duplicate_skipped ?? 0,
    viewer_open_wait_ms_total: scanResult.stats.viewer_open_wait_ms_total ?? 0,
    viewer_ready_wait_ms_total: scanResult.stats.viewer_ready_wait_ms_total ?? 0,
    viewer_menu_wait_ms_total: scanResult.stats.viewer_menu_wait_ms_total ?? 0,
    viewer_copy_wait_ms_total: scanResult.stats.viewer_copy_wait_ms_total ?? 0,
    viewer_close_wait_ms_total: scanResult.stats.viewer_close_wait_ms_total ?? 0,
    skipped_by_rule: scanResult.stats.skipped_by_rule ?? {},
    ui_probe_reasons: uiProbe.reasons ?? [],
    store_probe_reasons: storeProbe.reasons,
  };
  await fsImpl.writeFile(
    path.join(runDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8"
  );

  console.log(`\nRun manifest saved to: local/runs/${runTs}/manifest.json`);
  console.log("Done.");

  return {
    indexPath,
    manifest,
    merged,
    newRecords,
    uncertainRecords,
    pendingRecords,
    skippedRecords,
    uiProbe,
    storeProbe,
    runDir,
    sourceSelected,
  };
}
