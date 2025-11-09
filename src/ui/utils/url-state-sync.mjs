/**
 * URL State Sync - Bidirectional synchronization between Reef.js store and URL params
 *
 * This utility automatically syncs Reef.js reactive state with URL query parameters,
 * enabling deep linking and browser history navigation.
 *
 * Usage:
 * ```javascript
 * import { syncUrlState } from './utils/url-state-sync.mjs';
 * import { store } from 'reefjs';
 *
 * const myState = store({ tab: 'messages', filter: '' }, actions, 'mySignal');
 *
 * syncUrlState(myState, {
 *   // Map state keys to URL param names
 *   stateToUrl: {
 *     tab: 'tab',
 *     filter: 'q'
 *   },
 *   // Transform state value to URL param
 *   serialize: {
 *     tab: (value) => value || null  // null = remove from URL
 *   },
 *   // Transform URL param to state value
 *   deserialize: {
 *     tab: (value) => value || 'messages'
 *   },
 *   // Optional: only sync when condition is true
 *   shouldSync: (state) => state.isActive
 * });
 * ```
 */

import { store } from 'https://cdn.jsdelivr.net/npm/reefjs@13/dist/reef.es.min.js';

// Global registry to track URL param usage and prevent conflicts
const urlParamRegistry = new Map();

/**
 * Register URL params for a store and check for conflicts
 * @throws {Error} if URL param is already registered by another store
 */
function registerUrlParams(storeName, urlParams) {
  const conflicts = [];

  for (const urlKey of urlParams) {
    if (urlParamRegistry.has(urlKey)) {
      const existingStore = urlParamRegistry.get(urlKey);
      conflicts.push({
        urlKey,
        existingStore,
        newStore: storeName,
      });
    }
  }

  if (conflicts.length > 0) {
    const conflictMessages = conflicts
      .map(
        (c) =>
          `  - URL param "${c.urlKey}" is already used by store "${c.existingStore}"`,
      )
      .join('\n');

    throw new Error(
      `URL State Sync Conflict Detected!\n` +
        `Store "${storeName}" is trying to sync URL params that are already in use:\n` +
        `${conflictMessages}\n\n` +
        `Each URL param can only be synced by ONE store. Please use different URL param names.\n` +
        `Example: Instead of both using "tab", use "sidebarTab" and "panelTab".`,
    );
  }

  // Register all params
  for (const urlKey of urlParams) {
    urlParamRegistry.set(urlKey, storeName);
  }

  return urlParams;
}

/**
 * Unregister URL params when store is cleaned up
 */
function unregisterUrlParams(urlParams) {
  for (const urlKey of urlParams) {
    urlParamRegistry.delete(urlKey);
  }
}

/**
 * Create a URL state synchronizer for a Reef.js state
 *
 * @param {Object} reefState - Reef.js state created with store() or signal()
 * @param {Object} config - Configuration object
 * @param {string} config.signalName - The signal name passed to store() or signal() (REQUIRED)
 * @param {Object} config.stateToUrl - Map of state keys to URL param names
 * @param {Object} [config.serialize] - Custom serializers for state values
 * @param {Object} [config.deserialize] - Custom deserializers for URL params
 * @param {Function} [config.shouldSync] - Function to determine if sync should happen
 * @param {boolean} [config.pushState] - Use pushState (true) or replaceState (false)
 * @param {Function} [config.onPopState] - Custom handler for popstate events
 * @returns {Object} - Sync controller with cleanup method
 * @throws {Error} if URL params conflict with another state or signalName not provided
 */
export function syncUrlState(reefState, config = {}) {
  const {
    signalName,
    stateToUrl = {},
    serialize = {},
    deserialize = {},
    shouldSync = () => true,
    pushState = false,
    onPopState = null,
  } = config;

  // Validate signalName
  if (!signalName) {
    throw new Error(
      'syncUrlState requires config.signalName to be provided.\n' +
        'This should match the third parameter you passed to store().\n' +
        'Example: store(data, actions, "mySignal") → syncUrlState(myStore, { signalName: "mySignal", ... })',
    );
  }

  // Get store name for error messages
  const storeName = `signal:${signalName}`;

  // Extract URL params from config
  const urlParams = Object.values(stateToUrl);

  // Check for conflicts and register params (will throw if conflict)
  registerUrlParams(storeName, urlParams);

  let isUpdatingFromUrl = false;
  let isUpdatingFromState = false;

  // Track last synced state to detect actual changes
  const lastSyncedState = {};
  for (const stateKey of Object.keys(stateToUrl)) {
    // Get initial value (handle both signal and store)
    lastSyncedState[stateKey] = reefState._isSignal
      ? reefState[stateKey]
      : reefState.value[stateKey];
  }

  // Batching for signal updates: debounce multiple property changes in same tick
  let pendingUrlUpdate = null;
  function scheduleBatchedUrlUpdate() {
    if (pendingUrlUpdate) return; // Already scheduled

    pendingUrlUpdate = Promise.resolve().then(() => {
      pendingUrlUpdate = null;
      updateUrlFromState();
    });
  }

  // Get current URL params
  function getUrlParams() {
    return new URLSearchParams(window.location.search);
  }

  // Set URL params without triggering popstate
  function setUrlParams(params, push = false) {
    const url = new URL(window.location.href);
    url.search = params.toString();

    const method = push ? 'pushState' : 'replaceState';
    window.history[method](
      { ...window.history.state, urlStateSync: true },
      '',
      url.toString(),
    );
  }

  // Serialize state value to URL param
  function serializeValue(key, value) {
    if (serialize[key]) {
      return serialize[key](value);
    }
    // Default: convert to string, null/undefined = remove
    if (value == null || value === '') return null;
    return String(value);
  }

  // Deserialize URL param to state value
  function deserializeValue(key, paramValue) {
    if (deserialize[key]) {
      return deserialize[key](paramValue);
    }
    // Default: return as-is or null
    return paramValue || null;
  }

  // Update URL from state
  function updateUrlFromState() {
    if (isUpdatingFromUrl || !shouldSync(reefState.value)) return;

    isUpdatingFromState = true;

    try {
      const urlParams = getUrlParams();
      let hasChanges = false;

      // Update each mapped state key - only if value actually changed
      for (const [stateKey, urlKey] of Object.entries(stateToUrl)) {
        // Get current state value (handle both signal and store)
        const stateValue = reefState._isSignal
          ? reefState[stateKey]
          : reefState.value[stateKey];

        // Only update URL if state value changed since last sync
        if (stateValue !== lastSyncedState[stateKey]) {
          const urlValue = serializeValue(stateKey, stateValue);

          if (urlValue === null) {
            urlParams.delete(urlKey);
          } else {
            urlParams.set(urlKey, urlValue);
          }

          lastSyncedState[stateKey] = stateValue;
          hasChanges = true;
        }
      }

      // Only update URL if there were actual changes
      if (hasChanges) {
        setUrlParams(urlParams, pushState);
      }
    } finally {
      isUpdatingFromState = false;
    }
  }

  // Update state from URL
  function updateStateFromUrl() {
    if (isUpdatingFromState) return;

    isUpdatingFromUrl = true;

    try {
      const urlParams = getUrlParams();
      const updates = {};

      // Read each mapped URL param
      for (const [stateKey, urlKey] of Object.entries(stateToUrl)) {
        const urlValue = urlParams.get(urlKey);
        const stateValue = deserializeValue(stateKey, urlValue);

        // Get current state value (handle both signal and store)
        const currentValue = reefState._isSignal
          ? reefState[stateKey]
          : reefState.value[stateKey];

        // Update if value changed (allow null values)
        if (stateValue !== currentValue) {
          updates[stateKey] = stateValue;
          lastSyncedState[stateKey] = stateValue; // Update tracking
        }
      }

      // Apply updates to state
      if (Object.keys(updates).length > 0) {
        if (reefState._isSignal) {
          // Direct assignment for signal
          Object.assign(reefState, updates);
        } else if (typeof reefState.updateFromUrl === 'function') {
          // Use action for store()
          reefState.updateFromUrl(updates);
        } else {
          throw new Error(
            'syncUrlState with store() requires an updateFromUrl action.\n' +
              'Add: updateFromUrl(state, updates) { Object.assign(state, updates); }\n' +
              'Or consider using signal() instead of store() for URL-synced state.',
          );
        }
      }
    } finally {
      isUpdatingFromUrl = false;
    }
  }

  // Handle popstate (browser back/forward)
  function handlePopState(event) {
    if (onPopState) {
      // Custom handler
      onPopState(event, reefState);
    } else {
      // Default: sync state from URL
      updateStateFromUrl();
    }
  }
  // Initial sync from URL on setup
  updateStateFromUrl();

  // Listen to Reef.js signal event for state changes
  // Reef.js emits 'reef:signal-{name}' events on document when store changes
  const signalEventName = `reef:signal-${signalName}`;
  function handleSignalEvent() {
    // For signal: batch multiple property updates in same tick with Promise.resolve()
    // For store: actions already batch updates, so update immediately
    if (reefState._isSignal) {
      scheduleBatchedUrlUpdate();
    } else {
      updateUrlFromState();
    }
  }

  document.addEventListener(signalEventName, handleSignalEvent);

  // Listen to popstate
  window.addEventListener('popstate', handlePopState);

  // Return cleanup function
  return {
    cleanup() {
      window.removeEventListener('popstate', handlePopState);
      document.removeEventListener(signalEventName, handleSignalEvent);
      // Unregister URL params so they can be used again
      unregisterUrlParams(urlParams);
    },
    updateFromUrl: updateStateFromUrl,
    updateFromState: updateUrlFromState,
    // Expose registered params for debugging
    get registeredParams() {
      return urlParams;
    },
    get storeName() {
      return storeName;
    },
  };
}

/**
 * Simpler version: sync a single state key to URL param
 */
export function syncUrlParam(
  reefStore,
  stateKey,
  urlKey = stateKey,
  signalName,
  options = {},
) {
  return syncUrlState(reefStore, {
    signalName,
    stateToUrl: { [stateKey]: urlKey },
    ...options,
  });
}

/**
 * Create a URL-aware Reef.js store
 * Automatically syncs with URL on creation
 */
export function createUrlStore(initialState, actions, signalName, syncConfig) {
  const reefStore = store(initialState, actions, signalName);

  // Auto-sync with URL
  if (syncConfig) {
    syncUrlState(reefStore, syncConfig);
  }

  return reefStore;
}

/**
 * Debug utility: Get all currently registered URL params
 * Useful for troubleshooting conflicts
 */
export function getRegisteredUrlParams() {
  const registry = {};
  for (const [urlKey, storeName] of urlParamRegistry.entries()) {
    registry[urlKey] = storeName;
  }
  return registry;
}

/**
 * Debug utility: Check if a URL param is available
 */
export function isUrlParamAvailable(urlKey) {
  return !urlParamRegistry.has(urlKey);
}

/**
 * Debug utility: Print all registered URL params to console
 */
export function debugUrlRegistry() {
  console.group('🔗 URL State Sync Registry');

  if (urlParamRegistry.size === 0) {
    console.log('No URL params registered yet.');
  } else {
    console.table(
      Array.from(urlParamRegistry.entries()).map(([urlKey, storeName]) => ({
        'URL Param': urlKey,
        Store: storeName,
      })),
    );
  }

  console.groupEnd();
}

// Expose debug utilities on window in development
if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
  window.__urlStateSync = {
    getRegistry: getRegisteredUrlParams,
    isAvailable: isUrlParamAvailable,
    debug: debugUrlRegistry,
  };
  console.log(
    '%c[URL State Sync] Debug utilities available at window.__urlStateSync',
    'color: #0066cc; font-weight: bold;',
  );
}
