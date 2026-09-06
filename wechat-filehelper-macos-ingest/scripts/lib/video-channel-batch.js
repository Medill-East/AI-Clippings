import fs from "node:fs/promises";
import path from "node:path";

import { readJsonlines } from "./common.js";
import {
  fingerprintVideoProfile,
  runVideoChannelTask,
  videoTaskIdForUrl,
} from "./video-channel-pipeline.js";
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
    counts: {
      selected: selected.length,
      unique_videos: null,
      duplicate_links: null,
      identity_failed_links: 0,
      written: 0,
      failed: 0,
      skipped: 0,
      not_attempted: 0,
    },
    results: [],
  };
  await writeJsonAtomic(manifestPath, manifest);

  if (selected.length === 0) {
    manifest.counts.unique_videos = 0;
    manifest.counts.duplicate_links = 0;
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
  const prepared = [];
  const identityFailures = [];
  let blockedAuth = null;

  for (const [index, record] of selected.entries()) {
    const reusableTask = await readReusableVideoTask(rootDir, record.url);
    if (reusableTask) {
      prepared.push({
        record,
        profile: null,
        existingTask: reusableTask,
        identityKey:
          reusableTask.metadata?.content_fingerprint || `url:${record.url}`,
      });
      onEvent({
        type: "identity_state",
        index: index + 1,
        total: selected.length,
        state: "cached",
      });
      continue;
    }

    onEvent({
      type: "identity_state",
      index: index + 1,
      total: selected.length,
      state: "resolving",
    });
    try {
      const profile = await resolveFn(record.url);
      prepared.push({
        record,
        profile,
        existingTask: null,
        identityKey:
          fingerprintVideoProfile(profile) || `url:${record.url}`,
      });
    } catch (error) {
      const task = await runTaskSafely(record, {
        runTaskFn,
        options: taskOptions({
          rootDir,
          obsidianDir,
          keepArtifacts,
          nowFn,
          resolveFn: async () => {
            throw error;
          },
          downloadFn,
          transcribeFn,
          summarizeFn,
        }),
      });
      identityFailures.push(task);
      if (task.error_code === "auth_required") {
        blockedAuth = { index, task };
        break;
      }
    }
  }

  const groups = groupPreparedRecords(prepared);
  const identityComplete = blockedAuth === null;
  manifest.counts.unique_videos = identityComplete ? groups.length : null;
  manifest.counts.duplicate_links = identityComplete
    ? prepared.length - groups.length
    : null;
  manifest.counts.identity_failed_links = identityFailures.length;
  onEvent({
    type: "batch_prepared",
    selectedLinks: selected.length,
    uniqueVideos: manifest.counts.unique_videos,
    duplicateLinks: manifest.counts.duplicate_links,
  });

  for (const [index, group] of groups.entries()) {
    const [canonical, ...aliases] = canonicalFirst(group);
    const total = groups.length;
    onEvent({ type: "task_started", index: index + 1, total });
    let task;
    if (canonical.existingTask) {
      task = { ...canonical.existingTask, skipped_existing: true };
    } else {
      task = await runTaskSafely(canonical.record, {
        runTaskFn,
        options: taskOptions({
          rootDir,
          obsidianDir,
          keepArtifacts,
          nowFn,
          resolveFn: async () => canonical.profile,
          downloadFn,
          transcribeFn,
          summarizeFn,
          onProgress: (current, chunks) =>
            onEvent({
              type: "asr_progress",
              index: index + 1,
              total,
              current,
              chunks,
            }),
          onTransition: (state) =>
            onEvent({
              type: "task_state",
              index: index + 1,
              total,
              state,
            }),
        }),
      });
    }

    const redacted = redactTaskResult(task);
    manifest.results.push(redacted);
    if (task.skipped_existing || task.skipped_duplicate) {
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
      total,
      state: task.state,
      errorCode: task.error_code ?? null,
    });

    for (const alias of aliases) {
      let aliasTask;
      if (alias.existingTask) {
        aliasTask = { ...alias.existingTask, skipped_existing: true };
      } else if (task.state === "written" || task.skipped_existing || task.skipped_duplicate) {
        aliasTask = await runTaskSafely(alias.record, {
          runTaskFn,
          options: taskOptions({
            rootDir,
            obsidianDir,
            keepArtifacts,
            nowFn,
            resolveFn: async () => alias.profile,
            downloadFn,
            transcribeFn,
            summarizeFn,
          }),
        });
      } else {
        aliasTask = {
          task_id: null,
          source_url: alias.record.url,
          state: "not_attempted",
          failed_stage: task.failed_stage ?? "processing",
          error_code: "canonical_video_failed",
          error_message: "Not attempted because the canonical video task failed",
        };
      }
      const aliasResult = {
        ...redactTaskResult(aliasTask),
        canonical_source_url: canonical.record.url,
      };
      manifest.results.push(aliasResult);
      if (aliasTask.skipped_existing || aliasTask.skipped_duplicate) {
        manifest.counts.skipped += 1;
      } else if (aliasTask.state === "written") {
        manifest.counts.written += 1;
      } else if (aliasTask.state === "not_attempted") {
        manifest.counts.not_attempted += 1;
      } else {
        manifest.counts.failed += 1;
      }
      await writeJsonAtomic(manifestPath, manifest);
    }
  }

  manifest.results.push(...identityFailures.map(redactTaskResult));
  manifest.counts.failed += identityFailures.length;

  if (blockedAuth) {
    const remaining = selected.slice(blockedAuth.index + 1);
    manifest.results.push(
      ...remaining.map((pendingRecord) =>
        redactTaskResult({
          task_id: null,
          source_url: pendingRecord.url,
          state: "not_attempted",
          failed_stage: "resolving",
          error_code: "auth_required_not_attempted",
          error_message: "Not attempted after Yuanbao authentication failed earlier in this batch",
        }),
      ),
    );
    manifest.counts.not_attempted += remaining.length;
    manifest.status = "blocked_auth";
    manifest.finished_at = timestamp(nowFn);
    await writeJsonAtomic(manifestPath, manifest);
    onEvent({
      type: "batch_blocked_auth",
      failed: manifest.counts.failed,
      notAttempted: manifest.counts.not_attempted,
      recoveryCommand: "npm run video:auth",
    });
    return { ...manifest, manifestPath };
  }

  manifest.status = manifest.counts.failed > 0 ? "completed_with_failures" : "complete";
  manifest.finished_at = timestamp(nowFn);
  await writeJsonAtomic(manifestPath, manifest);
  return { ...manifest, manifestPath };
}

function taskOptions({
  rootDir,
  obsidianDir,
  keepArtifacts,
  nowFn,
  resolveFn,
  downloadFn,
  transcribeFn,
  summarizeFn,
  onProgress = () => {},
  onTransition = () => {},
}) {
  return {
    rootDir,
    obsidianDir,
    keepArtifacts,
    nowFn,
    resolveFn,
    downloadFn,
    transcribeFn: (mediaPath, transcriptPath, profile) =>
      transcribeFn(mediaPath, transcriptPath, {
        profile,
        onProgress,
      }),
    summarizeFn,
    onTransition,
  };
}

async function runTaskSafely(record, { runTaskFn, options }) {
  try {
    return await runTaskFn(record, options);
  } catch (error) {
    return {
      task_id: null,
      source_url: record.url,
      state: "failed",
      failed_stage: "task_start",
      error_code: "task_execution_failed",
      error_message: sanitizeError(error),
    };
  }
}

function groupPreparedRecords(prepared) {
  const groups = new Map();
  for (const entry of prepared) {
    const group = groups.get(entry.identityKey) ?? [];
    group.push(entry);
    groups.set(entry.identityKey, group);
  }
  return [...groups.values()];
}

function canonicalFirst(group) {
  const canonicalIndex = group.findIndex(
    (entry) => entry.existingTask?.state === "written",
  );
  if (canonicalIndex <= 0) return group;
  return [
    group[canonicalIndex],
    ...group.slice(0, canonicalIndex),
    ...group.slice(canonicalIndex + 1),
  ];
}

async function readReusableVideoTask(rootDir, sourceUrl) {
  const taskPath = path.join(
    rootDir,
    "tasks",
    videoTaskIdForUrl(sourceUrl),
    "task.json",
  );
  let task;
  try {
    task = JSON.parse(await fs.readFile(taskPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (
    !["written", "skipped_duplicate"].includes(task?.state) ||
    !task.note_path
  ) {
    return null;
  }
  try {
    await fs.access(task.note_path);
    return task;
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  }
}

function redactTaskResult(task) {
  return {
    task_id: task.task_id ?? null,
    source_url: task.source_url ?? null,
    state: task.state,
    skipped_existing: Boolean(task.skipped_existing),
    skipped_duplicate: Boolean(task.skipped_duplicate),
    duplicate_of_task_id: task.duplicate_of_task_id ?? null,
    note_path: task.note_path ?? null,
    media_bytes: task.media_bytes ?? null,
    media_duration_seconds: task.media_duration_seconds ?? null,
    transcript_chars: task.transcript_chars ?? null,
    evidence_type: task.evidence_type ?? null,
    speech_transcript_chars: task.speech_transcript_chars ?? null,
    visual_ocr_frames: task.visual_ocr_frames ?? null,
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
