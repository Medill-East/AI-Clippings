import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import * as ocrRuntime from "../scripts/lib/ocr.js";

const tempDirs = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    await fs.rm(tempDirs.pop(), { recursive: true, force: true });
  }
});

async function makeTempDir(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("ensureVisionHelperBinary", () => {
  it("compiles the Swift helper once and reuses the current binary", async () => {
    const root = await makeTempDir("vision-helper-");
    const sourcePath = path.join(root, "vision_text.swift");
    const binaryPath = path.join(root, "runtime", "vision-text");
    await fs.writeFile(sourcePath, "print(\"vision\")\n");
    let compileCalls = 0;

    assert.equal(typeof ocrRuntime.ensureVisionHelperBinary, "function");
    const options = {
      sourcePath,
      binaryPath,
      execFileFn: async (command, args) => {
        assert.equal(command, "xcrun");
        assert.deepEqual(args.slice(0, 2), ["swiftc", sourcePath]);
        const outputPath = args[args.indexOf("-o") + 1];
        compileCalls += 1;
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, "compiled");
      },
    };

    assert.equal(await ocrRuntime.ensureVisionHelperBinary(options), binaryPath);
    assert.equal(await ocrRuntime.ensureVisionHelperBinary(options), binaryPath);
    assert.equal(compileCalls, 1);
  });
});
