import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  captureWindowScreenshot,
  selectWeChatChatWindow,
} from "../scripts/lib/applescript.js";

describe("selectWeChatChatWindow", () => {
  it("ignores screenshot overlay windows and selects the named WeChat chat window", () => {
    const windows = [
      { index: 0, name: "", x: -546, y: -1440, width: 2560, height: 1440 },
      { index: 1, name: "", x: 0, y: 0, width: 1470, height: 956 },
      { index: 2, name: "Window", x: 6, y: 39, width: 66, height: 20 },
      { index: 3, name: "Weixin", x: 0, y: 33, width: 735, height: 923 },
    ];

    assert.deepEqual(selectWeChatChatWindow(windows), windows[3]);
  });
});

describe("captureWindowScreenshot", () => {
  it("captures WeChat through its own screenshot overlay", () => {
    const calls = [];
    const window = { x: 10, y: 20, width: 700, height: 800 };

    captureWindowScreenshot(window, "/tmp/wechat-window.png", {
      activateWeChatFn: () => calls.push(["activate"]),
      moveMouseToPointFn: (...args) => calls.push(["move", ...args]),
      sendSystemKeystrokeFn: (...args) => calls.push(["keystroke", ...args]),
      sendSystemKeyCodeFn: (...args) => calls.push(["keycode", ...args]),
      sleepMsFn: (ms) => calls.push(["sleep", ms]),
      captureRectScreenshotFn: (...args) => calls.push(["capture", ...args]),
    });

    assert.deepEqual(calls, [
      ["activate"],
      ["sleep", 500],
      ["move", 90, 100],
      ["keystroke", "a", ["control down", "command down"]],
      ["sleep", 800],
      ["capture", window, "/tmp/wechat-window.png"],
      ["keycode", 53],
      ["sleep", 100],
      ["keycode", 53],
      ["sleep", 300],
    ]);
  });

  it("always closes the screenshot overlay when capture fails", () => {
    const calls = [];

    assert.throws(
      () =>
        captureWindowScreenshot(
          { x: 0, y: 0, width: 700, height: 800 },
          "/tmp/wechat-window.png",
          {
            activateWeChatFn: () => {},
            moveMouseToPointFn: () => {},
            sendSystemKeystrokeFn: () => {},
            sendSystemKeyCodeFn: (...args) => calls.push(["keycode", ...args]),
            sleepMsFn: () => {},
            captureRectScreenshotFn: () => {
              throw new Error("capture failed");
            },
          }
        ),
      /capture failed/
    );

    assert.deepEqual(calls, [
      ["keycode", 53],
      ["keycode", 53],
    ]);
  });
});

it('does not send a second Escape into a video viewer after the capture overlay has closed',()=>{
  let frontApp='PixPin';const keys=[];
  const viewer={name:'Channels',x:100,y:40,width:800,height:700};
  captureWindowScreenshot(viewer,'/tmp/unused.png',{
    preserveViewer:true,activateWeChatFn:()=>{},raiseWeChatWindowFn:()=>{},moveMouseToPointFn:()=>{},
    sendSystemKeystrokeFn:()=>{},sleepMsFn:()=>{},captureRectScreenshotFn:()=>{},
    getFrontWeChatWindowFn:()=>viewer,getFrontmostApplicationNameFn:()=>frontApp,
    sendSystemKeyCodeFn:k=>{keys.push(k);frontApp='WeChat'},
  });
  assert.deepEqual(keys,[53]);
});
it('keeps a share popup open after dismissing the screenshot overlay',()=>{
  let app='PixPin';const keys=[];const host={name:'Weixin',x:0,y:33,width:1470,height:923};
  const popup={name:'',x:1200,y:730,width:200,height:120};
  captureWindowScreenshot({...host,x:735,width:735},'/tmp/unused.png',{
    preserveViewer:true,activateWeChatFn:()=>{},moveMouseToPointFn:()=>{},sendSystemKeystrokeFn:()=>{},
    sleepMsFn:()=>{},captureRectScreenshotFn:()=>{},getFrontWeChatWindowFn:()=>popup,
    getFrontmostApplicationNameFn:()=>app,sendSystemKeyCodeFn:k=>{keys.push(k);app='WeChat'},
  });
  assert.deepEqual(keys,[53]);
});
