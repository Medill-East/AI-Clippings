# Obsidian Web Clipper UI Notes

## Installed extension

- Extension ID: `cnjifjpddelmedmihgijeibhnjfabmlf`
- Version observed on this machine: `1.0.2`
- Chrome profile path: `%LOCALAPPDATA%/Google/Chrome/User Data/Default`
- Automation launch should use an isolated Playwright Chromium profile and copy only the Web Clipper storage directories needed for settings reuse.

## Relevant extension pages

- Popup page: `chrome-extension://<extension-id>/popup.html`
- Embedded iframe page: `chrome-extension://<extension-id>/side-panel.html?context=iframe`
- Settings page: `chrome-extension://<extension-id>/settings.html`

## Stable DOM hooks

- Injected iframe ID in the article page: `#obsidian-clipper-iframe`
- Main save button inside the iframe: `#clip-btn`
- Interpreter button inside the iframe: `#interpret-btn`
- Interpreter error area: `#interpreter-error`
- General error area: `.error-message`

## Internal behavior that matters for automation

- The browser side panel and toolbar popup both reuse `popup.js`.
- The content script can inject the embedded clipper iframe by handling the message `{ action: "toggle-iframe" }`.
- The content script removes the iframe on `{ action: "close-iframe" }`.
- The main save action is chosen by `determineMainAction()`. In the target setup it resolves to `Add to Obsidian`.
- `handleClipObsidian()` waits for the interpreter automatically:
  - If `#interpret-btn` is already processing, it waits for completion.
  - If the interpreter is enabled but not yet done, it clicks the interpreter button first and waits.
- Interpreter completion state is reflected by `#interpret-btn` classes:
  - `.processing`
  - `.done`
  - `.error`

## Why the automation uses the embedded iframe

Chrome's native extension popup and browser side panel are browser chrome, not normal page DOM. They are not reliable automation targets from Playwright.

The embedded iframe path is functionally equivalent for clipping but becomes a normal frame inside the target page, so it can be automated safely and repeatably.
