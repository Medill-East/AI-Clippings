import fs from "node:fs/promises";
import path from "node:path";

import { readJsonlines } from "./common.js";
import { runVideoChannelTask } from "./video-channel-pipeline.js";
import { resolveVideoChannel, validateSphUrl } from "./video-channel-resolver.js";
import {
  downloadVideoMedia,
  resolveObsidianClippingsDir,
  summarizeWithCodex,
  transcribeWithV2T,
} from "./video-channel-runtime.js";

export function selectVideoChannelRecords(records, { since, until, url } = {}) {
  const explicitUrl = url ? validateSphUrl(url) : null;
  const seen = new Set();
  const selected = [];

  for (const record of records) {
    if (!record?.url || !/^https?:\/\/(?:www\.)?weixin\.qq\.com\/sph\//i.test(record.url)) {
      continue;
    }
    let normalizedUrl;
    try {
      normalizedUrl = validateSphUrl(record.url);
    } catch {
      continue;
    }
    if (explicitUrl && normalizedUrl !== explicitUrl) continue;
    if (!explicitUrl) {
      const messageTime = new Date(record.message_time);
      if (Number.isNaN(messageTime.getTime())) continue;
      if (since && messageTime < since) continue;
      if (until && messageTime > until) continue;
    }
    if (seen.has(normalizedUrl)) continue;
    seen.add(normalizedUrl);
    selected.push({ ...record, url: normalizedUrl });
  }

  if (explicitUrl && selected.length === 0) {
    selected.push({
      url: explicitUrl,
      message_time: null,
      title: "",
      source: "explicit_url",
    });
  }

  return selected;
}

export async function runVideoBatch(
  {
    skillRoot,
    since,
    until,
    url,
    keepArtifacts = false,
    indexPath = path.join(skillRoot, "local/index/links.jsonl"),
  },
  {
    readJsonlinesFn = readJsonlines,
    resolveObsidianDirFn = resolveObsidianClippingsDir,
    runTaskFn = runVideoChannelTask,
    resolveFn = resolveVideoChannel,
    downloadFn = downloadVideoMedia,
    transcribeFn = transcribeWithV2T,
    summarizeFn = summarizeWithCodex,
    nowFn = () => new Date(),
    onEvent = () => {},
  } = {},
) {
  if (!skillRoot) throw new Error("skillRoot is required");
  const records = await readJsonlinesFn(indexPath);
  const selected = selectVideoChannelRecords(records, { since, until, url });
  const rootDir = path.join(skillRoot, "local/video-channel");
  const runTimestamp = timestamp(nowFn).replace(/[:.]/g, "-");
  const runDir = path.join(rootDir, "runs", runTimestamp);
  const manifestPath = path.join(runDir, "manifest.json");
  await fs.mkdir(runDir, { recursive: true });

  const manifest = {
    started_at: timestamp(nowFn),
    status: "running",
    selection: {
      since: since?.toISOString?.() ?? null,
      until: until?.toISOString?.() ?? null,
      explicit_url: url ?? null,
    },
    counts: { selected: selected.length, written: 0, failed: 0, skipped: 0 },
    results: [],
  };
  await writeJsonAtomic(manifestPath, manifest);

  if (selected.length === 0) {
    manifest.status = "complete";
    manifest.finished_at = timestamp(nowFn);
    await writeJsonAtomic(manifestPath, manifest);
    return { ...manifest, manifestPath };
  }

  let obsidianDir;
  try {
    obsidianDir = await resolveObsidianDirFn();
  } catch (error) {
    const errorCode =
      typeof error?.code === "string" && error.code
        ? error.code
        : "obsidian_target_failed";
    const errorMessage = sanitizeError(error);
    manifest.status = "failed";
    manifest.counts.failed = selected.length;
    manifest.results = selected.map((record) => ({
      task_id: null,
      source_url: record.url,
      state: "failed",
      skipped_existing: false,
      note_path: null,
      media_bytes: null,
      media_duration_seconds: null,
      transcript_chars: null,
      summary_chars: null,
      key_points_count: null,
      failed_stage: "obsidian_target",
      error_code: errorCode,
      error_message: errorMessage,
    }));
    manifest.finished_at = timestamp(nowFn);
    await writeJsonAtomic(manifestPath, manifest);
    await fs.appendFile(
      path.join(rootDir, "automation-failures.log"),
      `${JSON.stringify({
        at: manifest.finished_at,
        task_id: null,
        failed_stage: "obsidian_target",
        error_code: errorCode,
        error_message: errorMessage,
        selected_count: selected.length,
      })}\n`,
      "utf8",
    );
    onEvent({ type: "batch_failed", errorCode });
    return { ...manifest, manifestPath };
  }
  for (const [index, record] of selected.entries()) {
    onEvent({ type: "task_started", index: index + 1, total: selected.length });
    let task;
    try {
      task = await runTaskFn(record, {
        rootDir,
        obsidianDir,
        keepArtifacts,
        nowFn,
        resolveFn,
        downloadFn,
        transcribeFn: (mediaPath, transcriptPath, profile) =>
          transcribeFn(mediaPath, transcriptPath, {
            profile,
            onProgress: (current, total) =>
              onEvent({
                type: "asr_progress",
                index: index + 1,
                total: selected.length,
                current,
                chunks: total,
              }),
          }),
        summarizeFn,
        onTransition: (state) =>
          onEvent({
            type: "task_state",
            index: index + 1,
            total: selected.length,
            state,
          }),
      });
    } catch (error) {
      task = {
        task_id: null,
        source_url: record.url,
        state: "failed",
        failed_stage: "task_start",
        error_code: "task_execution_failed",
        error_message: sanitizeError(error),
      };
    }

    const redacted = redactTaskResult(task);
    manifest.results.push(redacted);
    if (task.skipped_existing) {
      manifest.counts.skipped += 1;
    } else if (task.state === "written") {
      manifest.counts.written += 1;
    } else {
      manifest.counts.failed += 1;
    }
    await writeJsonAtomic(manifestPath, manifest);
    onEvent({
      type: "task_finished",
      index: index + 1,
      total: selected.length,
      state: task.state,
      errorCode: task.error_code ?? null,
    });
  }

  manifest.status = manifest.counts.failed > 0 ? "completed_with_failures" : "complete";
  manifest.finished_at = timestamp(nowFn);
  await writeJsonAtomic(manifestPath, manifest);
  return { ...manifest, manifestPath };
}

function redactTaskResult(task) {
  return {
    task_id: task.task_id ?? null,
    source_url: task.source_url ?? null,
    state: task.state,
    skipped_existing: Boolean(task.skipped_existing),
    note_path: task.note_path ?? null,
    media_bytes: task.media_bytes ?? null,
    media_duration_seconds: task.media_duration_seconds ?? null,
    transcript_chars: task.transcript_chars ?? null,
    summary_chars: task.summary_chars ?? null,
    key_points_count: task.key_points_count ?? null,
    failed_stage: task.failed_stage ?? null,
    error_code: task.error_code ?? null,
    error_message: task.error_message ?? null,
  };
}

function sanitizeError(error) {
  return String(error instanceof Error ? error.message : error)
    .replace(/https?:\/\/\S+/gi, "[URL_REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .slice(0, 600);
}

function timestamp(nowFn) {
  const value = nowFn();
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
}
