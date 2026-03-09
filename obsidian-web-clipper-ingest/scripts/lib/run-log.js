import path from "node:path";

import { ensureDir, timestampSlug, writeJson } from "./fs-utils.js";
import { runsDir } from "./config.js";

export async function createRunArtifacts() {
  const runId = timestampSlug();
  const runDir = path.join(runsDir, runId);
  const screenshotsDir = path.join(runDir, "screenshots");
  const manifestPath = path.join(runDir, "manifest.json");

  await ensureDir(screenshotsDir);

  return {
    runId,
    runDir,
    screenshotsDir,
    manifestPath,
  };
}

export async function writeManifest(manifestPath, manifest) {
  await writeJson(manifestPath, manifest);
}
