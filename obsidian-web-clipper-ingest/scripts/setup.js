import path from "node:path";

import {
  configPath,
  ensureLocalLayout,
  extensionVersionDir,
  hasConfig,
  loadConfig,
  makeDefaultConfig,
  profilePath,
  saveConfig,
} from "./lib/config.js";
import { findInstalledExtensionVersion, pathExists } from "./lib/chrome.js";

async function main() {
  await ensureLocalLayout();

  if (!(await hasConfig())) {
    await saveConfig(makeDefaultConfig());
    console.log(`Created default config at ${configPath}`);
  }

  const config = await loadConfig();
  const checks = [];

  checks.push({
    name: "chromePath",
    ok: await pathExists(config.chromePath),
    detail: config.chromePath,
  });

  checks.push({
    name: "userDataDir",
    ok: await pathExists(config.userDataDir),
    detail: config.userDataDir,
  });

  checks.push({
    name: "automationUserDataDir",
    ok: true,
    detail: config.automationUserDataDir,
  });

  checks.push({
    name: "profileDirectory",
    ok: await pathExists(profilePath(config)),
    detail: path.join(config.userDataDir, config.profileDirectory),
  });

  const extensionRoot = extensionVersionDir(config);
  const extensionVersion = await findInstalledExtensionVersion(extensionRoot);
  checks.push({
    name: "extension",
    ok: Boolean(extensionVersion),
    detail: extensionVersion ? `${config.extensionId} @ ${extensionVersion}` : extensionRoot,
  });

  for (const check of checks) {
    console.log(`${check.ok ? "[OK]" : "[FAIL]"} ${check.name}: ${check.detail}`);
  }

  if (checks.some((check) => !check.ok)) {
    process.exitCode = 1;
    return;
  }

  console.log(`Ready. Config: ${configPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
