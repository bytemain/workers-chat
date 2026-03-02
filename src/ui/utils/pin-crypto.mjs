/**
 * Pin Message Utilities
 * Crypto has been removed for broader browser compatibility.
 */

/**
 * Return pins array as-is (crypto removed)
 * @param {Array} pins - Array of pin objects with message property
 * @returns {Promise<Array>} - Array of pins
 */
export async function decryptPins(pins) {
  return pins || [];
}
