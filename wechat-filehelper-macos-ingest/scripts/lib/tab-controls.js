import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { ensureVisionHelperBinary } from "./ocr.js";
const exec = promisify(execFile);
export async function detectArticleTabClose(imagePath, layout) {
  const binary = await ensureVisionHelperBinary({
    sourcePath: fileURLToPath(new URL('./tab-controls.swift', import.meta.url)),
    binaryPath: fileURLToPath(new URL('../../local/runtime/tab-controls', import.meta.url)),
  });
  const {stdout} = await exec(binary, [imagePath,
    fileURLToPath(new URL('../../references/article-tab-close.png', import.meta.url)),
    String(layout.windowWidth), String(layout.chatWidth)], {timeout: 20000});
  const result = JSON.parse(stdout);
  return result.matched ? result : null;
}
