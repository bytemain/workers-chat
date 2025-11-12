/**
 * Reef.js utility helpers
 */

/**
 * Listen to a Reef.js signal event
 * @param {string} signalName - Name of the signal to listen to
 * @param {function} callback - Callback function to execute when signal changes
 * @returns {function} Cleanup function to remove the event listener
 *
 * @example
 * const cleanup = listenReefEvent('messagesSignal', () => {
 *   console.log('Messages changed!');
 * });
 *
 * // Later, to remove the listener:
 * cleanup();
 */
export function listenReefEvent(signalName, callback) {
  const eventName = `reef:signal-${signalName}`;
  document.addEventListener(eventName, callback);

  // Return cleanup function
  return () => {
    document.removeEventListener(eventName, callback);
  };
}

/**
 * Listen to a Reef.js render event
 * @param {function} callback - Callback function to execute on render
 * @returns {function} Cleanup function to remove the event listener
 *
 * @example
 * const cleanup = listenReefRender(() => {
 *   console.log('Component rendered!');
 * });
 */
export function listenReefRender(callback) {
  document.addEventListener('reef:render', callback);

  // Return cleanup function
  return () => {
    document.removeEventListener('reef:render', callback);
  };
}
