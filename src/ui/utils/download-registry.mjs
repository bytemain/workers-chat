/**
 * Module-level registry for in-flight file downloads.
 *
 * Keyed by `fileUrl`, this registry survives DOM re-creation so that:
 *   - Rapid clicks on the same download button never spawn multiple fetches.
 *   - When the surrounding chat message re-renders mid-download, the new
 *     <file-message> instance picks up the existing download and shows its
 *     current progress instead of resetting.
 *   - A short blob cache lets the user re-trigger the browser save dialog
 *     without re-downloading.
 *
 * Public API:
 *   getDownload(url)           -> entry | null
 *   subscribeDownload(url, cb) -> unsubscribe()
 *   startOrResaveDownload(url, fileName) -> entry
 *   cancelDownload(url)
 */

const DONE_DISPLAY_MS = 1500; // duration of the "✓" check icon
const ERROR_DISPLAY_MS = 5000; // auto-clear an error state
const BLOB_CACHE_MS = 30000; // keep decoded blob for re-save without refetch
const PROGRESS_NOTIFY_INTERVAL_MS = 100; // throttle UI updates to ~10/s

/**
 * @typedef {Object} DownloadEntry
 * @property {string} url
 * @property {string} fileName
 * @property {'downloading'|'done'|'idle-cached'|'error'} status
 * @property {{loaded: number, total: number, indeterminate: boolean}} progress
 * @property {AbortController|null} abortController
 * @property {Set<Function>} subscribers
 * @property {Blob|null} blob
 * @property {string|null} blobUrl
 * @property {Error|null} error
 * @property {number|null} doneTimer
 * @property {number|null} cacheExpiryTimer
 * @property {number|null} errorTimer
 */

/** @type {Map<string, DownloadEntry>} */
const registry = new Map();

function notify(entry) {
  for (const listener of entry.subscribers) {
    try {
      listener(entry);
    } catch (e) {
      console.error('download-registry subscriber error', e);
    }
  }
}

function clearTimers(entry) {
  if (entry.doneTimer != null) {
    clearTimeout(entry.doneTimer);
    entry.doneTimer = null;
  }
  if (entry.cacheExpiryTimer != null) {
    clearTimeout(entry.cacheExpiryTimer);
    entry.cacheExpiryTimer = null;
  }
  if (entry.errorTimer != null) {
    clearTimeout(entry.errorTimer);
    entry.errorTimer = null;
  }
}

function deleteEntry(url, { revoke = true } = {}) {
  const entry = registry.get(url);
  if (!entry) return;
  clearTimers(entry);
  if (revoke && entry.blobUrl) {
    URL.revokeObjectURL(entry.blobUrl);
  }
  entry.blob = null;
  entry.blobUrl = null;
  registry.delete(url);
  // Notify subscribers one last time with `null` so they reset to idle.
  for (const listener of entry.subscribers) {
    try {
      listener(null);
    } catch (e) {
      console.error('download-registry subscriber error', e);
    }
  }
  entry.subscribers.clear();
}

function triggerSave(blobUrl, fileName) {
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function getDownload(url) {
  return registry.get(url) || null;
}

/**
 * Subscribe to entry updates for `url`. The listener is invoked synchronously
 * with the current entry on subscribe (when one exists).
 * Returns an unsubscribe function that's safe to call multiple times.
 */
export function subscribeDownload(url, listener) {
  const entry = registry.get(url);
  if (!entry) return () => {};
  entry.subscribers.add(listener);
  try {
    listener(entry);
  } catch (e) {
    console.error('download-registry initial notify error', e);
  }
  return () => {
    const current = registry.get(url);
    if (current) current.subscribers.delete(listener);
    // If the entry was already deleted, there's nothing to remove.
  };
}

/**
 * Cancel an in-flight download. No-op if not active.
 */
export function cancelDownload(url) {
  const entry = registry.get(url);
  if (!entry) return;
  if (entry.status === 'downloading' && entry.abortController) {
    try {
      entry.abortController.abort();
    } catch {
      /* ignore */
    }
  }
  // performFetch's catch handles the AbortError path and deletes the entry.
}

/**
 * Start a new download, resume rendering of an in-flight one, or re-trigger
 * the save dialog from the cached blob when available.
 *
 * Returns the entry so the caller can immediately render its current state.
 */
export function startOrResaveDownload(url, fileName) {
  let entry = registry.get(url);

  if (entry) {
    if (entry.status === 'downloading') {
      // Already in flight; nothing more to do, just return the entry.
      return entry;
    }
    if (
      (entry.status === 'done' || entry.status === 'idle-cached') &&
      entry.blobUrl
    ) {
      // Re-save from cached blob without refetching.
      triggerSave(entry.blobUrl, entry.fileName || fileName);
      return entry;
    }
    if (entry.status === 'error') {
      // Treat a click on an errored entry as a retry: tear it down and
      // restart below.
      deleteEntry(url);
      entry = null;
    }
  }

  const abortController = new AbortController();
  entry = {
    url,
    fileName,
    status: 'downloading',
    progress: { loaded: 0, total: 0, indeterminate: true },
    abortController,
    subscribers: new Set(),
    blob: null,
    blobUrl: null,
    error: null,
    doneTimer: null,
    cacheExpiryTimer: null,
    errorTimer: null,
  };
  registry.set(url, entry);

  // Fire-and-forget; performFetch handles all error states internally.
  performFetch(entry);

  return entry;
}

async function performFetch(entry) {
  try {
    const response = await fetch(entry.url, {
      signal: entry.abortController.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const contentLengthHeader = response.headers.get('content-length');
    const total = parseInt(contentLengthHeader, 10);
    const indeterminate = !Number.isFinite(total) || total <= 0;
    entry.progress = {
      loaded: 0,
      total: indeterminate ? 0 : total,
      indeterminate,
    };
    notify(entry);

    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    let lastNotify = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      entry.progress.loaded = loaded;

      const now = performance.now();
      if (now - lastNotify >= PROGRESS_NOTIFY_INTERVAL_MS) {
        lastNotify = now;
        notify(entry);
      }
    }

    // Final 100% notification.
    if (!entry.progress.indeterminate) {
      entry.progress.loaded = entry.progress.total;
    }
    notify(entry);

    const blob = new Blob(chunks);
    const blobUrl = URL.createObjectURL(blob);
    entry.blob = blob;
    entry.blobUrl = blobUrl;
    entry.status = 'done';
    entry.abortController = null;
    notify(entry);

    triggerSave(blobUrl, entry.fileName);

    // After DONE_DISPLAY_MS the check icon reverts to a normal idle button,
    // but we keep the blob cached for BLOB_CACHE_MS so that re-clicks within
    // that window skip the network entirely.
    entry.doneTimer = setTimeout(() => {
      const current = registry.get(entry.url);
      if (current === entry && entry.status === 'done') {
        entry.status = 'idle-cached';
        notify(entry);
      }
      entry.doneTimer = null;
    }, DONE_DISPLAY_MS);

    entry.cacheExpiryTimer = setTimeout(() => {
      if (registry.get(entry.url) === entry) {
        deleteEntry(entry.url);
      }
    }, BLOB_CACHE_MS);
  } catch (error) {
    if (error && error.name === 'AbortError') {
      // User cancelled; remove entry and let subscribers reset to idle.
      deleteEntry(entry.url);
      return;
    }
    console.error('❌ Download failed:', error);
    entry.status = 'error';
    entry.error = error;
    entry.abortController = null;
    notify(entry);

    entry.errorTimer = setTimeout(() => {
      if (registry.get(entry.url) === entry && entry.status === 'error') {
        deleteEntry(entry.url);
      }
    }, ERROR_DISPLAY_MS);
  }
}

// Best-effort cleanup of any cached blob URLs on navigation/unload.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    for (const url of Array.from(registry.keys())) {
      deleteEntry(url);
    }
  });
}
