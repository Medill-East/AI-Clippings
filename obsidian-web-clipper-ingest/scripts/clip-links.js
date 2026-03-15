import path from "node:path";

import {
  configPath,
  ensureLocalLayout,
  extensionVersionDir,
  loadConfig,
} from "./lib/config.js";
import {
  closeClipperIframe,
  configureExtensionForAutomation,
  findInstalledExtensionVersion,
  getActiveTabId,
  getExtensionWorker,
  launchChromeContext,
  pathExists,
  toggleClipperIframe,
} from "./lib/chrome.js";
import {
  confirmPostAdd,
  readClipTarget,
  scrollPageFully,
  waitForClipperFrame,
  waitForPageBaseline,
  waitForReadyToAdd,
} from "./lib/clipper.js";
import { resolveObsidianVault, waitForImportedNote } from "./lib/obsidian.js";
import { getRetryConcurrencyPlan, mergeAttemptResult } from "./lib/retries.js";
import { createRunArtifacts, writeManifest } from "./lib/run-log.js";
import { parseInputUrls } from "./lib/urls.js";

const dryRun = process.env.OBSIDIAN_CLIPPER_DRY_RUN === "1";

async function preflight(config) {
  if (!(await pathExists(config.chromePath))) {
    throw new Error(`Chrome executable not found: ${config.chromePath}`);
  }

  if (!(await pathExists(config.userDataDir))) {
    throw new Error(`Chrome user data dir not found: ${config.userDataDir}`);
  }

  const extensionVersion = await findInstalledExtensionVersion(extensionVersionDir(config));
  if (!extensionVersion) {
    throw new Error(`Obsidian Web Clipper extension not found: ${config.extensionId}`);
  }

  return { extensionVersion };
}

async function stageClipTask({ artifacts, attempt, config, context, passConcurrency, worker, index, url }) {
  const page = await context.newPage();
  const screenshotPath = path.join(
    artifacts.screenshotsDir,
    `a${String(attempt).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}.png`,
  );
  const result = {
    url,
    status: "pending",
    attempt,
    attemptConcurrency: passConcurrency,
    startedAt: new Date().toISOString(),
    screenshotPath,
  };

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.bringToFront();
    await page.waitForTimeout(500);
    await waitForPageBaseline(page);
    result.pageTitle = await page.title();

    await scrollPageFully(page, config);
    await page.bringToFront();
    await page.waitForTimeout(300);

    const tabId = await getActiveTabId(worker);
    if (!tabId) {
      throw new Error("Could not determine the active tab ID for Web Clipper.");
    }

    await toggleClipperIframe(worker, tabId);
    const frame = await waitForClipperFrame(page, 20000);

    return {
      frame,
      page,
      readyPromise: waitForReadyToAdd(frame, config.summaryTimeoutMs)
        .then((readyState) => ({ ok: true, readyState }))
        .catch((error) => ({ ok: false, error })),
      result,
      screenshotPath,
      tabId,
    };
  } catch (error) {
    result.status = "failed";
    result.error = error instanceof Error ? error.message : String(error);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    await page.close().catch(() => {});
    return { completed: true, result };
  }
}

async function finalizeTask({
  config,
  dryRunEnabled,
  task,
  vaultInfo,
  waitOutcome,
  worker,
}) {
  const { frame, page, result, screenshotPath, tabId } = task;

  try {
    result.readyState = waitOutcome;

    if (dryRunEnabled) {
      result.status = "dry-run";
      result.confirmation = "skipped-by-dry-run";
    } else {
      await page.bringToFront();
      await page.waitForTimeout(300);

      result.clipTarget = await readClipTarget(frame);
      const importStartedAtMs = Date.now();
      await frame.locator("#clip-btn").click();
      const uiConfirmation = await confirmPostAdd(page, frame, config.postAddTimeoutMs);

      let importedNote = null;
      if (vaultInfo?.path) {
        importedNote = await waitForImportedNote({
          noteName: result.clipTarget?.noteName ?? "",
          sourceUrl: result.clipTarget?.sourceUrl ?? "",
          title: result.clipTarget?.title ?? "",
          vaultPath: vaultInfo.path,
          startedAfterMs: importStartedAtMs - 1000,
          timeoutMs: Math.max(config.postAddTimeoutMs, 30000),
        });
      }

      if (vaultInfo?.path && !importedNote) {
        throw new Error(
          `Add to Obsidian was clicked, but no imported note was detected in vault: ${vaultInfo.path}`,
        );
      }

      result.confirmation = {
        ui: uiConfirmation,
        vault: vaultInfo?.path ? "note-detected" : "skipped-no-vault-path",
      };
      if (importedNote) {
        result.importedNote = importedNote;
      }
      result.status = "success";
    }
  } catch (error) {
    result.status = "failed";
    result.error = error instanceof Error ? error.message : String(error);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  } finally {
    result.finishedAt = new Date().toISOString();
    await closeClipperIframe(worker, tabId).catch(() => {});
    await page.close().catch(() => {});
  }
}

async function recordResult(manifest, manifestPath, resultsByUrl, result) {
  result.finishedAt ??= new Date().toISOString();
  const previousResult = resultsByUrl.get(result.url);
  const mergedResult = mergeAttemptResult(previousResult, result);

  resultsByUrl.set(result.url, mergedResult);
  manifest.results = Array.from(resultsByUrl.values());
  await writeManifest(manifestPath, manifest);
}

function summarizeResults(results) {
  return {
    success: results.filter((result) => result.status === "success").length,
    failed: results.filter((result) => result.status === "failed").length,
    dryRun: results.filter((result) => result.status === "dry-run").length,
  };
}

async function runPass({
  artifacts,
  attempt,
  config,
  context,
  dryRunEnabled,
  manifest,
  urls,
  vaultInfo,
  worker,
  passConcurrency,
  resultsByUrl,
}) {
  const pass = {
    attempt,
    maxConcurrentSummaries: passConcurrency,
    startedAt: new Date().toISOString(),
    urls,
    results: [],
  };
  manifest.passes.push(pass);
  await writeManifest(artifacts.manifestPath, manifest);

  const activeTasks = [];
  let nextIndex = 0;

  async function persistResult(result) {
    pass.results.push({
      url: result.url,
      status: result.status,
      attempt: result.attempt,
      attemptConcurrency: result.attemptConcurrency,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      error: result.error,
    });
    await recordResult(manifest, artifacts.manifestPath, resultsByUrl, result);
  }

  async function stageNextTasks() {
    while (nextIndex < urls.length && activeTasks.length < passConcurrency) {
      const stagedTask = await stageClipTask({
        attempt,
        artifacts,
        config,
        context,
        index: nextIndex,
        passConcurrency,
        url: urls[nextIndex],
        worker,
      });

      nextIndex += 1;

      if (stagedTask.completed) {
        await persistResult(stagedTask.result);
        continue;
      }

      activeTasks.push(stagedTask);
    }
  }

  await stageNextTasks();

  while (activeTasks.length > 0) {
    const { task, readiness } = await Promise.race(
      activeTasks.map((task) => task.readyPromise.then((readyState) => ({ task, readiness: readyState }))),
    );

    const taskIndex = activeTasks.indexOf(task);
    if (taskIndex >= 0) {
      activeTasks.splice(taskIndex, 1);
    }

    if (!readiness.ok) {
      task.result.status = "failed";
      task.result.error = readiness.error instanceof Error ? readiness.error.message : String(readiness.error);
      await task.page.screenshot({ path: task.screenshotPath, fullPage: true }).catch(() => {});
      await closeClipperIframe(worker, task.tabId).catch(() => {});
      await task.page.close().catch(() => {});
      await persistResult(task.result);
    } else {
      await finalizeTask({
        config,
        dryRunEnabled,
        task,
        vaultInfo,
        waitOutcome: readiness.readyState,
        worker,
      });
      pass.results.push({
        url: task.result.url,
        status: task.result.status,
        attempt: task.result.attempt,
        attemptConcurrency: task.result.attemptConcurrency,
        startedAt: task.result.startedAt,
        finishedAt: task.result.finishedAt,
        error: task.result.error,
      });
      await recordResult(manifest, artifacts.manifestPath, resultsByUrl, task.result);
    }

    await stageNextTasks();
  }

  pass.finishedAt = new Date().toISOString();
  pass.summary = summarizeResults(pass.results);
  await writeManifest(artifacts.manifestPath, manifest);

  return pass.results.filter((result) => result.status === "failed").map((result) => result.url);
}

async function main() {
  await ensureLocalLayout();
  const config = await loadConfig().catch(() => {
    throw new Error(`Missing or invalid config. Run \`node ./scripts/setup.js\` first. Expected: ${configPath}`);
  });
  const urls = await parseInputUrls(process.argv.slice(2));
  const { extensionVersion } = await preflight(config);
  const artifacts = await createRunArtifacts();
  const manifest = {
    startedAt: new Date().toISOString(),
    dryRun,
    config: {
      chromePath: config.chromePath,
      userDataDir: config.userDataDir,
      automationUserDataDir: config.automationUserDataDir,
      profileDirectory: config.profileDirectory,
      extensionId: config.extensionId,
      extensionVersion,
      summaryTimeoutMs: config.summaryTimeoutMs,
      postAddTimeoutMs: config.postAddTimeoutMs,
      maxConcurrentSummaries: config.maxConcurrentSummaries,
      scrollStepPx: config.scrollStepPx,
      scrollPauseMs: config.scrollPauseMs,
    },
    retryPolicy: dryRun
      ? {
          enabled: false,
          retries: [],
        }
      : {
          enabled: true,
          retries: getRetryConcurrencyPlan(config.maxConcurrentSummaries),
        },
    passes: [],
    results: [],
  };

  let context;
  let session;
  const resultsByUrl = new Map();

  try {
    session = await launchChromeContext(config);
    context = session.context;
    const worker = await getExtensionWorker(context, config.extensionId);
    const extensionState = await configureExtensionForAutomation(worker);
    const vaultInfo = await resolveObsidianVault(extensionState.vaults);

    manifest.obsidian = {
      automationGeneralSettings: extensionState.generalSettings,
      vault: vaultInfo,
    };
    await writeManifest(artifacts.manifestPath, manifest);

    let pendingUrls = urls;
    let attempt = 1;
    let passConcurrency = config.maxConcurrentSummaries;

    pendingUrls = await runPass({
      artifacts,
      attempt,
      config,
      context,
      dryRunEnabled: dryRun,
      manifest,
      urls: pendingUrls,
      vaultInfo,
      worker,
      passConcurrency,
      resultsByUrl,
    });

    if (!dryRun) {
      for (const retryConcurrency of getRetryConcurrencyPlan(config.maxConcurrentSummaries)) {
        if (pendingUrls.length === 0) {
          break;
        }

        attempt += 1;
        passConcurrency = retryConcurrency;
        pendingUrls = await runPass({
          artifacts,
          attempt,
          config,
          context,
          dryRunEnabled: dryRun,
          manifest,
          urls: pendingUrls,
          vaultInfo,
          worker,
          passConcurrency,
          resultsByUrl,
        });
      }
    }
  } finally {
    manifest.finishedAt = new Date().toISOString();
    await writeManifest(artifacts.manifestPath, manifest);
    await session?.close().catch(() => {});
  }

  const { dryRun: dryRunCount, failed: failureCount, success: successCount } = summarizeResults(manifest.results);

  console.log(`Run manifest: ${artifacts.manifestPath}`);
  console.log(`Success: ${successCount}  Failed: ${failureCount}  Dry-run: ${dryRunCount}`);
  if (failureCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
