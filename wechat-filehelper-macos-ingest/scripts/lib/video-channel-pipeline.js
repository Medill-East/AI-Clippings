import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export class PipelineError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "PipelineError";
    this.code = code;
  }
}

export async function runVideoChannelTask(
  record,
  {
    rootDir,
    obsidianDir,
    resolveFn,
    downloadFn,
    transcribeFn,
    summarizeFn,
    writeNoteFn = writeVideoNote,
    keepArtifacts = false,
    nowFn = () => new Date(),
    onTransition = () => {},
  },
) {
  if (!rootDir || !obsidianDir) {
    throw new PipelineError(
      "pipeline_config_invalid",
      "rootDir and obsidianDir are required",
    );
  }
  for (const [name, dependency] of Object.entries({
    resolveFn,
    downloadFn,
    transcribeFn,
    summarizeFn,
  })) {
    if (typeof dependency !== "function") {
      throw new PipelineError(
        "pipeline_config_invalid",
        `${name} must be a function`,
      );
    }
  }

  const taskId = createHash("sha256").update(record.url).digest("hex").slice(0, 16);
  const taskDir = path.join(rootDir, "tasks", taskId);
  const taskPath = path.join(taskDir, "task.json");
  const mediaPath = path.join(taskDir, "media.mp4");
  const transcriptPath = path.join(taskDir, "transcript.txt");
  const failureLogPath = path.join(rootDir, "automation-failures.log");
  await fs.mkdir(taskDir, { recursive: true });

  const previous = await readJsonIfExists(taskPath);
  if (
    ["written", "skipped_duplicate"].includes(previous?.state) &&
    previous.note_path &&
    (await pathExists(previous.note_path))
  ) {
    return { ...previous, skipped_existing: true };
  }

  const task = {
    task_id: taskId,
    task_path: taskPath,
    source_url: record.url,
    source_message_time: record.message_time ?? null,
    source_title: record.title ?? "",
    state: "pending",
    started_at: timestamp(nowFn),
    updated_at: timestamp(nowFn),
    history: [],
    artifacts: {
      media_path: mediaPath,
      transcript_path: transcriptPath,
    },
  };

  let activeStage = "pending";
  const transition = async (state, details = {}) => {
    activeStage = state;
    task.state = state;
    task.updated_at = timestamp(nowFn);
    Object.assign(task, details);
    task.history.push({ state, at: task.updated_at });
    await writeJsonAtomic(taskPath, task);
    onTransition(state, structuredClone(task));
  };

  await transition("pending");

  try {
    await transition("resolving");
    const profile = await resolveFn(record.url);
    task.metadata = {
      title: profile.title ?? "微信视频号",
      author: profile.author ?? "",
      cover_url: profile.coverUrl ?? "",
      media_type: profile.mediaType ?? null,
      create_time: profile.createTime ?? null,
      media_url_fingerprint: profile.urlFingerprint ?? null,
      content_fingerprint: fingerprintVideoProfile(profile),
    };

    const duplicate = task.metadata.content_fingerprint
      ? await findWrittenDuplicateTask(
          rootDir,
          taskId,
          task.metadata.content_fingerprint,
        )
      : null;
    if (duplicate) {
      task.skipped_duplicate = true;
      task.duplicate_of_task_id = duplicate.task_id;
      task.note_path = duplicate.note_path;
      task.finished_at = timestamp(nowFn);
      await transition("skipped_duplicate");
      return task;
    }

    await transition("downloading");
    const download = await downloadFn(profile, mediaPath);
    task.media_bytes = download.bytes;
    task.media_duration_seconds = download.durationSeconds ?? null;

    await transition("transcribing");
    const transcription = await transcribeFn(mediaPath, transcriptPath, {
      ...profile,
      durationSeconds: download.durationSeconds ?? null,
    });
    const transcript = String(transcription?.text ?? "").trim();
    if (!transcript) {
      throw new PipelineError("asr_empty", "ASR returned no usable text");
    }
    task.transcript_chars = transcript.length;
    task.asr_provider = transcription.provider ?? null;
    task.evidence_type = transcription.evidenceType ?? "speech_asr";
    task.speech_transcript_chars =
      transcription.speechTranscriptChars ?? transcript.length;
    task.visual_ocr_frames = transcription.visualOcrFrames ?? 0;

    await transition("summarizing");
    const summary = normalizeSummary(
      await summarizeFn({
        transcript,
        transcriptPath,
        profile,
        record,
        taskDir,
      }),
    );
    task.summary_chars = summary.summary.length;
    task.key_points_count = summary.key_points.length;
    const noteTitle = conciseVideoTitle(
      profile.title || record.title || "微信视频号",
    );

    const notePath = await writeNoteFn(
      {
        sourceUrl: record.url,
        title: noteTitle,
        author: profile.author || "",
        publishedAt: normalizePublishedAt(profile.createTime),
        createdAt: timestamp(nowFn),
        summary: summary.summary,
        keyPoints: summary.key_points,
      },
      { obsidianDir, taskId },
    );
    task.note_path = notePath;
    task.finished_at = timestamp(nowFn);
    await transition("written");
    return task;
  } catch (error) {
    const errorCode =
      typeof error?.code === "string" && error.code
        ? error.code
        : `${activeStage}_failed`;
    task.failed_stage = activeStage;
    task.error_code = errorCode;
    task.error_message = sanitizeErrorMessage(
      error instanceof Error ? error.message : String(error),
    );
    task.failed_at = timestamp(nowFn);
    await transition("failed");
    await fs.mkdir(path.dirname(failureLogPath), { recursive: true });
    await fs.appendFile(
      failureLogPath,
      `${JSON.stringify({
        at: task.failed_at,
        task_id: taskId,
        source_url: record.url,
        failed_stage: task.failed_stage,
        error_code: task.error_code,
        error_message: task.error_message,
      })}\n`,
      "utf8",
    );
    return task;
  } finally {
    if (!keepArtifacts) {
      await Promise.all([
        fs.rm(mediaPath, { force: true }).catch(() => {}),
        fs.rm(transcriptPath, { force: true }).catch(() => {}),
        fs.rm(`${mediaPath}.part`, { force: true }).catch(() => {}),
      ]);
    }
  }
}

export function renderVideoNote({
  sourceUrl,
  title,
  author,
  publishedAt,
  createdAt,
  summary,
  keyPoints,
}) {
  const description = String(summary).replace(/\s+/g, " ").trim().slice(0, 220);
  const lines = [
    "---",
    `title: ${yamlString(title)}`,
    `source: ${yamlString(sourceUrl)}`,
    `author: ${yamlString(author)}`,
    `published: ${yamlString(publishedAt ?? "")}`,
    `published_text: ${yamlString(publishedAt ?? "")}`,
    `created: ${yamlString(createdAt)}`,
    `description: ${yamlString(description)}`,
    `site: ${yamlString("微信视频号")}`,
    `type: ${yamlString("video-channel")}`,
    `tags: [${yamlString("微信视频号")}]`,
    "---",
    "",
    `# ${title}`,
    "",
    `> 原始链接：[打开视频号](${sourceUrl})`,
  ];
  if (author) {
    lines.push(`> 作者：${author}`);
  }
  lines.push("", "## 高质量摘要", "", summary, "", "## 关键要点", "");
  for (const point of keyPoints) {
    lines.push(`- ${point}`);
  }
  lines.push("");
  return lines.join("\n");
}

export async function writeVideoNote(note, { obsidianDir, taskId }) {
  await fs.mkdir(obsidianDir, { recursive: true });
  const body = renderVideoNote(note);
  const base = safeFileStem(note.title || "微信视频号");
  const candidates = [
    path.join(obsidianDir, `${base}.md`),
    path.join(obsidianDir, `${base}-${taskId.slice(0, 8)}.md`),
  ];

  for (const candidate of candidates) {
    try {
      await fs.writeFile(candidate, body, { encoding: "utf8", flag: "wx" });
      const written = await fs.readFile(candidate, "utf8");
      if (!isVerifiedVideoNote(written, note.sourceUrl)) {
        await fs.rm(candidate, { force: true });
        throw new PipelineError(
          "note_verification_failed",
          "Obsidian note was written but failed content verification",
        );
      }
      return candidate;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const existing = await fs.readFile(candidate, "utf8").catch(() => "");
      if (isVerifiedVideoNote(existing, note.sourceUrl)) {
        return candidate;
      }
    }
  }

  throw new PipelineError(
    "note_name_conflict",
    "Could not create a unique Obsidian note path",
  );
}

function isVerifiedVideoNote(content, sourceUrl) {
  return (
    content.includes(sourceUrl) &&
    content.includes('type: "video-channel"') &&
    content.includes("## 高质量摘要") &&
    content.includes("## 关键要点")
  );
}

function normalizeSummary(value) {
  const summary = String(value?.summary ?? "").trim();
  const keyPoints = Array.isArray(value?.key_points)
    ? value.key_points.map((item) => String(item).trim()).filter(Boolean)
    : [];
  if (!summary) {
    throw new PipelineError("summary_empty", "Summarizer returned no summary");
  }
  if (keyPoints.length < 3) {
    throw new PipelineError(
      "key_points_missing",
      "Summarizer returned fewer than three key points",
    );
  }
  return { summary, key_points: keyPoints };
}

function conciseVideoTitle(value) {
  const firstLine = String(value ?? "")
    .normalize("NFKC")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const withoutHashtags = String(firstLine ?? "").split("#", 1)[0].trim();
  return withoutHashtags.slice(0, 160) || "微信视频号";
}

function safeFileStem(value) {
  return (
    String(value)
      .normalize("NFKC")
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/[. ]+$/g, "")
      .trim()
      .slice(0, 100) || "微信视频号"
  );
}

function yamlString(value) {
  return JSON.stringify(String(value ?? ""));
}

function normalizePublishedAt(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    return new Date(milliseconds).toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function timestamp(nowFn) {
  const value = nowFn();
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function sanitizeErrorMessage(message) {
  return String(message)
    .replace(/https?:\/\/\S+/gi, "[URL_REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\b(token|eid|access_token)=([^\s&]+)/gi, "$1=[REDACTED]")
    .slice(0, 600);
}

function fingerprintVideoProfile(profile) {
  const title = normalizeIdentityText(profile.title);
  const author = normalizeIdentityText(profile.author);
  const createTime = profile.createTime ?? null;
  if (createTime == null || (!title && !author)) return null;

  return createHash("sha256")
    .update(JSON.stringify([title, author, String(createTime), profile.mediaType ?? null]))
    .digest("hex");
}

function normalizeIdentityText(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

async function findWrittenDuplicateTask(rootDir, currentTaskId, contentFingerprint) {
  const tasksDir = path.join(rootDir, "tasks");
  let entries;
  try {
    entries = await fs.readdir(tasksDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || entry.name === currentTaskId) continue;
    const candidate = await readJsonIfExists(path.join(tasksDir, entry.name, "task.json"));
    if (
      candidate?.state !== "written" ||
      candidate.metadata?.content_fingerprint !== contentFingerprint ||
      !candidate.note_path ||
      !(await pathExists(candidate.note_path))
    ) {
      continue;
    }
    return candidate;
  }
  return null;
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
