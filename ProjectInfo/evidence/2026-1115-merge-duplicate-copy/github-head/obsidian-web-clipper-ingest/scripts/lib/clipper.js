export async function waitForPageBaseline(page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
}

export async function scrollPageFully(page, { scrollStepPx, scrollPauseMs }) {
  await page.evaluate(() => {
    const root = document.scrollingElement || document.documentElement;
    root.scrollTo({ top: 0, left: 0, behavior: "instant" });
  });

  let stableCount = 0;
  let lastTop = -1;

  for (let i = 0; i < 500; i += 1) {
    const state = await page.evaluate((stepPx) => {
      const root = document.scrollingElement || document.documentElement;
      root.scrollBy({ top: stepPx, left: 0, behavior: "instant" });
      return {
        scrollTop: root.scrollTop,
        scrollHeight: root.scrollHeight,
        clientHeight: root.clientHeight,
      };
    }, scrollStepPx);

    const distanceToBottom = state.scrollHeight - state.clientHeight - state.scrollTop;
    if (state.scrollTop === lastTop || distanceToBottom <= 2) {
      stableCount += 1;
    } else {
      stableCount = 0;
    }
    lastTop = state.scrollTop;

    await page.waitForTimeout(scrollPauseMs);
    if (stableCount >= 3) {
      break;
    }
  }

  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const root = document.scrollingElement || document.documentElement;
    root.scrollTo({ top: 0, left: 0, behavior: "instant" });
  });
  await page.waitForTimeout(300);
}

export async function waitForClipperFrame(page, timeoutMs) {
  const iframe = page.locator("#obsidian-clipper-iframe");
  await iframe.waitFor({ state: "visible", timeout: timeoutMs });
  const handle = await iframe.elementHandle();
  if (!handle) {
    throw new Error("Clipper iframe appeared but no element handle was available.");
  }

  const frame = await handle.contentFrame();
  if (!frame) {
    throw new Error("Clipper iframe appeared but no frame context was available.");
  }

  await frame.waitForSelector("#clip-btn", { timeout: timeoutMs });
  return frame;
}

export async function waitForReadyToAdd(frame, timeoutMs) {
  const startedAt = Date.now();
  let lastState = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastState = await frame.evaluate(() => {
      const clipButton = document.querySelector("#clip-btn");
      const interpretButton = document.querySelector("#interpret-btn");
      const interpreterError = document.querySelector("#interpreter-error");
      const errorMessage = document.querySelector(".error-message");

      const firstVisibleText = [errorMessage, interpreterError]
        .filter(Boolean)
        .map((node) => {
          const element = node;
          if (!element.textContent) {
            return "";
          }
          const style = window.getComputedStyle(element);
          return style.display === "none" ? "" : element.textContent.trim();
        })
        .find(Boolean);

      return {
        clipText: clipButton?.textContent?.trim() ?? "",
        clipDisabled: Boolean(clipButton?.disabled),
        clipVisible: Boolean(clipButton),
        interpretText: interpretButton?.textContent?.trim() ?? "",
        interpretClassName: interpretButton?.className ?? "",
        errorText: firstVisibleText ?? "",
      };
    });

    if (lastState.errorText) {
      throw new Error(`Clipper error: ${lastState.errorText}`);
    }

    if (
      lastState.clipVisible &&
      !lastState.clipDisabled &&
      /add to obsidian/i.test(lastState.clipText)
    ) {
      return lastState;
    }

    await frame.waitForTimeout(1000);
  }

  const summary = lastState
    ? `clip="${lastState.clipText}" disabled=${lastState.clipDisabled} interpret="${lastState.interpretText}" classes="${lastState.interpretClassName}"`
    : "no state captured";
  throw new Error(`Timed out waiting for Add to Obsidian to become ready. Last state: ${summary}`);
}

export async function readClipTarget(frame) {
  return frame.evaluate(() => ({
    noteName: document.querySelector("#note-name-field")?.value?.trim() ?? "",
    title: document.querySelector("#title")?.value?.trim() ?? "",
    sourceUrl: document.querySelector("#source")?.value?.trim() ?? "",
  }));
}

export async function confirmPostAdd(page, frame, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if ((await page.locator("#obsidian-clipper-iframe").count()) === 0) {
      return "iframe-closed";
    }

    try {
      const state = await frame.evaluate(() => {
        const interpreterError = document.querySelector("#interpreter-error");
        const errorMessage = document.querySelector(".error-message");
        const visibleError = [errorMessage, interpreterError]
          .filter(Boolean)
          .map((node) => {
            const element = node;
            const style = window.getComputedStyle(element);
            return style.display === "none" ? "" : element.textContent?.trim() ?? "";
          })
          .find(Boolean);

        const clipButton = document.querySelector("#clip-btn");
        const pageText = document.body?.innerText ?? "";
        return {
          errorText: visibleError ?? "",
          clipDisabled: Boolean(clipButton?.disabled),
          clipText: clipButton?.textContent?.trim() ?? "",
          successText: pageText.match(/pages?\s+saved|saved\s+to\s+obsidian|added\s+to\s+obsidian/i)?.[0] ?? "",
        };
      });

      if (state.errorText) {
        throw new Error(`Add to Obsidian failed: ${state.errorText}`);
      }

      if (state.successText) {
        return `success-text:${state.successText}`;
      }

      if (state.clipDisabled && Date.now() - startedAt >= 1000) {
        return "clip-disabled";
      }

      if (!/add to obsidian/i.test(state.clipText) && Date.now() - startedAt >= 1000) {
        return "clip-state-changed";
      }

      if (!state.clipDisabled && Date.now() - startedAt >= 2000) {
        return "stable-no-error";
      }
    } catch (error) {
      if (String(error.message).includes("detached")) {
        return "frame-detached";
      }
      throw error;
    }

    await page.waitForTimeout(500);
  }

  return "timeout-no-error";
}
