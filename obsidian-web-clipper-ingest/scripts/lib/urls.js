import fs from "node:fs/promises";

export async function parseInputUrls(argv) {
  const args = [...argv];
  const inputIndex = args.indexOf("--input");
  let urls = [];

  if (inputIndex >= 0) {
    const filePath = args[inputIndex + 1];
    if (!filePath) {
      throw new Error("`--input` requires a file path.");
    }

    const content = await fs.readFile(filePath, "utf8");
    urls.push(
      ...content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
    );

    args.splice(inputIndex, 2);
  }

  urls.push(...args.filter(Boolean));
  if (urls.length === 0) {
    throw new Error("Provide at least one URL or use `--input <file>`.");
  }

  for (const url of urls) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`Unsupported URL protocol: ${url}`);
    }
  }

  return urls;
}
