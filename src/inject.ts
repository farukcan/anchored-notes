// Programmatically inject the content script into a tab. Declarative content
// scripts only load into tabs navigated after install, so tabs open from before
// install/update have no content script; this re-injects the bundled content.js
// on demand (popup/context-menu retry) and in bulk on install (see background).

// Must be self-contained: chrome.scripting.executeScript({ func }) serializes
// only the function source — no module closures — into the tab's isolated world.
function hasLiveInjection(): boolean {
  const marker = "__anchoredNotesInjected";
  const w = window as unknown as {
    [key: string]: { version?: string } | boolean | undefined;
  };
  const prev = w[marker];
  if (!prev || typeof prev !== "object") return false;
  try {
    return prev.version === chrome.runtime.getManifest().version;
  } catch {
    return false;
  }
}

function clearInjectionGuard(): void {
  const marker = "__anchoredNotesInjected";
  const w = window as unknown as {
    [key: string]: { onMessage?: (message: unknown) => void } | boolean | undefined;
  };
  const prev = w[marker];
  if (prev && typeof prev === "object" && typeof prev.onMessage === "function") {
    try {
      chrome.runtime.onMessage.removeListener(prev.onMessage);
    } catch {
      // Orphaned extension context after update/reload.
    }
  }
  delete w[marker];
}

const inflight = new Map<number, Promise<void>>();

export async function injectContentScript(tabId: number): Promise<void> {
  const pending = inflight.get(tabId);
  if (pending) return pending;

  const run = (async () => {
    // Skip if this extension generation is already running (avoids double bootstrap
    // when injectIntoOpenTabs races with a living script or overlapping injects).
    const [check] = await chrome.scripting.executeScript({
      target: { tabId },
      func: hasLiveInjection,
      injectImmediately: true
    });
    if (check?.result) return;

    // Drop a prior generation's guard so the fresh bundle can bootstrap. After an
    // extension update/reload, orphaned scripts leave the marker set in the shared
    // isolated world; without clearing, the new content.js would skip init.
    await chrome.scripting.executeScript({
      target: { tabId },
      func: clearInjectionGuard,
      injectImmediately: true
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
      injectImmediately: true
    });
  })().finally(() => {
    inflight.delete(tabId);
  });

  inflight.set(tabId, run);
  return run;
}
