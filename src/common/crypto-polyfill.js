/**
 * WebCrypto API Polyfill Loader
 * Conditionally loads webcrypto-liner polyfill when native support is incomplete
 */

/**
 * Check if WebCrypto API needs polyfilling
 * @returns {boolean} true if polyfill is needed
 */
function needsPolyfill() {
  // Check if crypto object exists
  if (!window.crypto || !window.crypto.subtle) {
    return true;
  }

  // Check if importKey method exists
  if (typeof window.crypto.subtle.importKey !== 'function') {
    return true;
  }

  // Check if encrypt method exists
  if (typeof window.crypto.subtle.encrypt !== 'function') {
    return true;
  }

  // Check if decrypt method exists
  if (typeof window.crypto.subtle.decrypt !== 'function') {
    return true;
  }

  // Check if deriveKey method exists
  if (typeof window.crypto.subtle.deriveKey !== 'function') {
    return true;
  }

  return false;
}

/**
 * Load and initialize WebCrypto polyfill
 * @returns {Promise<boolean>} true if polyfill was loaded, false if native support is sufficient
 */
export async function loadCryptoPolyfill() {
  // Check if polyfill is needed
  if (!needsPolyfill()) {
    console.log('✅ Native WebCrypto API detected, polyfill not needed');
    return false;
  }

  console.log('⚠️ WebCrypto API incomplete, loading polyfill...');

  try {
    // Dynamically import webcrypto-liner
    const { Crypto } = await import('webcrypto-liner');

    // Create polyfill instance
    const crypto = new Crypto();

    // Replace window.crypto with polyfilled version
    // The polyfill will use native implementations when available
    // and fall back to JavaScript implementations when not
    window.crypto = crypto;

    console.log('✅ WebCrypto polyfill loaded successfully');
    return true;
  } catch (error) {
    console.error('❌ Failed to load WebCrypto polyfill:', error);
    // Return false - the crypto-compat check will handle showing error to user
    return false;
  }
}

export default {
  loadCryptoPolyfill,
  needsPolyfill,
};
