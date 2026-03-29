import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VISION_HELPER_PATH = path.join(__dirname, "vision_text.swift");

export async function probeVisionAvailability() {
  try {
    const { stdout } = await execFileAsync("swift", ["-e", 'import Vision; print("vision_ok")'], {
      encoding: "utf8",
      timeout: 20_000,
    });
    return stdout.trim() === "vision_ok";
  } catch {
    return false;
  }
}

export async function recognizeTextFromImage(imagePath) {
  const resolvedPath = path.resolve(imagePath);
  await fs.access(resolvedPath);

  const { stdout } = await execFileAsync("swift", [VISION_HELPER_PATH, resolvedPath], {
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  const parsed = JSON.parse(stdout);
  return {
    width: parsed.width ?? 0,
    height: parsed.height ?? 0,
    lines: Array.isArray(parsed.lines)
      ? parsed.lines.map((line) => ({
          text: String(line.text ?? ""),
          x: Number(line.x ?? 0),
          y: Number(line.y ?? 0),
          width: Number(line.width ?? 0),
          height: Number(line.height ?? 0),
          confidence: Number(line.confidence ?? 0),
        }))
      : [],
  };
}
