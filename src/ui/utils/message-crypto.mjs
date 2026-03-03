/**
 * Message text utilities
 * Crypto has been removed for broader browser compatibility.
 * These functions now pass through message text as-is.
 */

/**
 * Return message text as-is (crypto removed)
 * @param {Object} data - Message data object with `message` property
 * @returns {Promise<string>} Message text
 */
export async function tryDecryptMessage(data) {
  return data.message;
}

/**
 * Return message text as-is (crypto removed)
 * @param {string} message - Message text
 * @returns {Promise<string>} Message text
 */
export async function decryptMessageText(message) {
  return message;
}
