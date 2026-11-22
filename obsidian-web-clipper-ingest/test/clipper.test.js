import test from "node:test";
import assert from "node:assert/strict";

import { inferInterpreterState, isReadyToAddState } from "../scripts/lib/clipper.js";

test("inferInterpreterState detects done state from class or text", () => {
  assert.equal(inferInterpreterState({
    interpretVisible: true,
    interpretText: "Interpret",
    interpretClassName: "btn done",
  }), "done");

  assert.equal(inferInterpreterState({
    interpretVisible: true,
    interpretText: "Done",
    interpretClassName: "btn",
  }), "done");
});

test("inferInterpreterState distinguishes idle from processing", () => {
  assert.equal(inferInterpreterState({
    interpretVisible: true,
    interpretText: "Interpret",
    interpretClassName: "btn",
  }), "idle");

  assert.equal(inferInterpreterState({
    interpretVisible: true,
    interpretText: "Interpret",
    interpretClassName: "btn processing",
  }), "processing");
});

test("isReadyToAddState requires interpreter completion when present", () => {
  assert.equal(isReadyToAddState({
    clipText: "Add to Obsidian",
    clipDisabled: false,
    clipVisible: true,
    interpretVisible: true,
    interpretText: "Interpret",
    interpretClassName: "",
  }), false);

  assert.equal(isReadyToAddState({
    clipText: "Add to Obsidian",
    clipDisabled: false,
    clipVisible: true,
    interpretVisible: true,
    interpretText: "Done",
    interpretClassName: "done",
  }), true);
});
