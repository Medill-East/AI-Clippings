#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { runVideoBatch } from "./lib/video-channel-batch.js";
import { authenticateYuanbao } from "./lib/video-channel-resolver.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0] && !args[0].startsWith("--") ? args.shift() : "process";
  const options = {
    command,
    since: null,
    until: null,
    url: null,
    keepArtifacts: false,
    json: false,
    timeoutMs: 10 * 60_000,
  };

  for (let index = 0; index < args.length; index += 1) {
    switch (args[index]) {
      case "--since":
        options.since = new Date(args[++index]);
        break;
      case "--until":
        options.until = new Date(args[++index]);
        break;
      case "--url":
        options.url = args[++index];
        break;
      case "--keep-artifacts":
        options.keepArtifacts = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--timeout":
        options.timeoutMs = Number(args[++index]) * 1000;
        break;
      case "--help":
      case "-h":
        options.command = "help";
        break;
      default:
        throw new Error(`Unknown argument: ${args[index]}`);
    }
  }

  if (options.command === "process") {
    if (!options.url && (!options.since || !options.until)) {
      throw new Error("process requires --url, or both --since and --until");
    }
    if (
      (options.since && Number.isNaN(options.since.getTime())) ||
      (options.until && Number.isNaN(options.until.getTime()))
    ) {
      throw new Error("Invalid date value");
    }
    if (options.since && options.until && options.since > options.until) {
      throw new Error("--since must not be later than --until");
    }
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout must be a positive number of seconds");
  }
  return options;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/process-video-channels.js auth [--timeout 600]",
    "  node scripts/process-video-channels.js process --url <weixin.qq.com/sph/...> [--json]",
    "  node scripts/process-video-channels.js process --since <ISO8601> --until <ISO8601> [--json]",
    "",
    "Options:",
    "  --keep-artifacts   Keep temporary media/transcript for debugging (default deletes them)",
    "  --json             Print only the final redacted batch result to stdout",
  ].join("\n");
}

function formatEvent(event, stream) {
  if (event.type === "batch_blocked_auth") {
    stream.write(
      `Yuanbao authentication is required; ${event.notAttempted} remaining video(s) were not attempted. Run: ${event.recoveryCommand}\n`,
    );
    return;
  }
  const prefix = `[video ${event.index}/${event.total}]`;
  if (event.type === "task_state") {
    stream.write(`${prefix} ${event.state}\n`);
  } else if (event.type === "asr_progress") {
    stream.write(`${prefix} ASR ${event.current}/${event.chunks}\n`);
  } else if (event.type === "task_finished" && event.state === "failed") {
    stream.write(`${prefix} failed: ${event.errorCode}\n`);
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    console.error(usage());
    process.exit(1);
  }

  if (options.command === "help") {
    console.log(usage());
    return;
  }
  if (options.command === "auth") {
    console.log("Opening the dedicated Yuanbao login window...");
    await authenticateYuanbao({ timeoutMs: options.timeoutMs });
    console.log("Yuanbao authentication is active.");
    return;
  }
  if (options.command !== "process") {
    throw new Error(`Unknown command: ${options.command}`);
  }

  const progressStream = options.json ? process.stderr : process.stdout;
  const result = await runVideoBatch(
    {
      skillRoot,
      since: options.since,
      until: options.until,
      url: options.url,
      keepArtifacts: options.keepArtifacts,
    },
    {
      onEvent: (event) => formatEvent(event, progressStream),
    },
  );

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `Video batch complete: selected=${result.counts.selected}, written=${result.counts.written}, skipped=${result.counts.skipped}, failed=${result.counts.failed}, not_attempted=${result.counts.not_attempted}`,
    );
    console.log(`Manifest: ${result.manifestPath}`);
  }
  if (result.counts.failed > 0) process.exitCode = 2;
}

main().catch((error) => {
  console.error(
    `Fatal: code=${String(error?.code ?? "unknown")} message=${String(error?.message ?? error).replace(/https?:\/\/\S+/gi, "[URL_REDACTED]")}`,
  );
  process.exit(1);
});
