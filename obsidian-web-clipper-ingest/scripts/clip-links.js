import fs from "node:fs/promises";
import {
  assertClipSource,
  isWeChatVerificationRedirect,
  matchesWeChatArticle,
} from "./lib/clip-validation.js";
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
  getExtensionWorker,
  getTabIdForUrl,
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
const allowWeChatHandoff = process.env.OBSIDIAN_CLIPPER_WECHAT_HANDOFF === "1";
const verificationTimeoutMs = 20 * 60_000;
const clipperSourceTimeoutMs = 20_000;

function assertArticleSource(pageUrl, requestedUrl) {
  const requested = new URL(requestedUrl);
  if (allowWeChatHandoff && requested.hostname === "mp.weixin.qq.com" &&
      !matchesWeChatArticle(new URL(pageUrl), requested)) {
    throw new Error("Browser left the requested WeChat article");
  }
}

async function waitForClipperSource(frame, page, requestedUrl) {
  const expected = [requestedUrl, page.url()];
  await frame.waitForFunction((sources) => {
    const source = document.querySelector("#source")?.value?.trim().split("#")[0];
    const error = [...document.querySelectorAll(".error-message")].some((node) =>
      node.getClientRects().length && node.textContent?.trim());
    return error || (source && sources.includes(source));
  }, expected.map((value) => value.split("#")[0]), { timeout: clipperSourceTimeoutMs });
  const target = await readClipTarget(frame);
  if (!target.sourceUrl) throw new Error("Web Clipper did not bind to the requested tab");
  assertClipSource(target.sourceUrl, expected);
}

async function waitForWeChatArticle(page, requested, timeout) {
  await page.waitForURL((next) => matchesWeChatArticle(next, requested), {
    waitUntil: "domcontentloaded",
    timeout,
  });
  await page.locator("#js_content").waitFor({ state: "attached", timeout: 15000 });
}

async function waitForWeChatVerification(task, requested) {
  const { page, result } = task;
  result.verification = "waiting";
  console.log(JSON.stringify({
    event: "wechat_verification_required",
    url: result.url,
    timeoutMs: verificationTimeoutMs,
  }));
  try {
    await waitForWeChatArticle(page, requested, verificationTimeoutMs);
  } catch (error) {
    result.verification = "incomplete";
    const message = page.isClosed()
      ? "WeChat verification tab was closed before the article loaded"
      : "WeChat verification did not return to the requested article";
    return { ok: false, error: new Error(message, { cause: error }) };
  }
  result.verification = "article_loaded";
  console.log(JSON.stringify({ event: "wechat_article_loaded", url: result.url }));
  return { ok: true, resume: true };
}

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
  const task = { page, result, screenshotPath };

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(500);
    await waitForPageBaseline(page);
    const requested = new URL(url);
    if (isWeChatVerificationRedirect(new URL(page.url()), requested)) {
      if (allowWeChatHandoff) {
        return { ...task, readyPromise: waitForWeChatVerification(task, requested) };
      }
      result.verification = "required";
      throw new Error("WeChat verification requires the user");
    }
    if (allowWeChatHandoff && requested.hostname === "mp.weixin.qq.com") {
      await waitForWeChatArticle(page, requested, 15000);
    }
  } catch (error) {
    return failStaging(task, error);
  }
  return stageArticle(task, { config, worker });
}

async function failStaging(task, error) {
  const { page, result, screenshotPath } = task;
  result.status = "failed";
  result.error = error instanceof Error ? error.message : String(error);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  await page.close().catch(() => {});
  return { completed: true, result };
}

async function stageArticle(task, { config, worker }) {
  const { page, result } = task;
  const { url } = result;
  try {
    result.pageTitle = await page.title();
    assertClipSource(page.url(), [url, page.url()]);

    await scrollPageFully(page, config);
    // The extension chooses its source from the active tab during initialization.
    await page.bringToFront();
    await page.waitForTimeout(300);

    assertArticleSource(page.url(), url);
    const tabId = await getTabIdForUrl(worker, page.url());
    if (!tabId) {
      throw new Error(`Could not determine the tab ID for Web Clipper page: ${page.url()}`);
    }

    await toggleClipperIframe(worker, tabId);
    const frame = await waitForClipperFrame(page, 20000);
    await waitForClipperSource(frame, page, url);

    return {
      ...task,
      frame,
      readyPromise: waitForReadyToAdd(frame, config.summaryTimeoutMs)
        .then((readyState) => ({ ok: true, readyState }))
        .catch((error) => ({ ok: false, error })),
      tabId,
    };
  } catch (error) {
    return failStaging(task, error);
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
      // The extension uses the active tab to hand the note to Obsidian.
      await page.bringToFront();
      await page.waitForTimeout(300);

      result.clipTarget = await readClipTarget(frame);
      assertArticleSource(page.url(), result.url);
      assertClipSource(result.clipTarget.sourceUrl, [result.url, page.url()]);
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

      if (importedNote) {
        const content = await fs.readFile(importedNote.filePath, "utf8");
        if (!content.includes(result.clipTarget.sourceUrl)) {
          throw new Error("Imported note does not contain the expected source URL");
        }
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
      verification: result.verification,
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
      if (task.tabId) await closeClipperIframe(worker, task.tabId).catch(() => {});
      const failed = await failStaging(task, readiness.error);
      await persistResult(failed.result);
    } else if (readiness.resume) {
      const resumed = await stageArticle(task, { config, worker });
      if (resumed.completed) await persistResult(resumed.result);
      else activeTasks.push(resumed);
    } else {
      await finalizeTask({
        config,
        dryRunEnabled,
        task,
        vaultInfo,
        waitOutcome: readiness.readyState,
        worker,
      });
      await persistResult(task.result);
    }

    await stageNextTasks();
  }

  pass.finishedAt = new Date().toISOString();
  pass.summary = summarizeResults(pass.results);
  await writeManifest(artifacts.manifestPath, manifest);

  return pass.results
    .filter((result) =>
      result.status === "failed" &&
      result.verification !== "required" &&
      result.verification !== "incomplete")
    .map((result) => result.url);
}

async function main() {
  await ensureLocalLayout();
  const config = await loadConfig().catch(() => {
    throw new Error(`Missing or invalid config. Run \`node ./scripts/setup.js\` first. Expected: ${configPath}`);
  });
  const urls = await parseInputUrls(process.argv.slice(2));
  const retries = dryRun || process.env.OBSIDIAN_CLIPPER_NO_RETRY === "1"
    ? []
    : getRetryConcurrencyPlan(config.maxConcurrentSummaries);
  const { extensionVersion } = await preflight(config);
  const artifacts = await createRunArtifacts();
  const manifest = {
    startedAt: new Date().toISOString(),
    dryRun,
    wechatHandoff: allowWeChatHandoff,
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
    retryPolicy: { enabled: retries.length > 0, retries },
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

    for (const retryConcurrency of retries) {
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
