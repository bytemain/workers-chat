/**
 * Crypto API Compatibility Check
 * Detects if Web Crypto API is available and provides fallback/error handling
 */

/**
 * Check if Web Crypto API is available
 * @returns {Object} {available: boolean, reason?: string, isWeChat?: boolean}
 */
export function checkCryptoSupport() {
  // Check if running in WeChat browser
  const isWeChat = /MicroMessenger/i.test(navigator.userAgent);

  // Check if crypto object exists
  if (!window.crypto) {
    return {
      available: false,
      reason: 'window.crypto is not available',
      isWeChat,
    };
  }

  // Check if subtle crypto is available
  if (!window.crypto.subtle) {
    return {
      available: false,
      reason: 'window.crypto.subtle is not available',
      isWeChat,
    };
  }

  // Check if we're in a secure context (HTTPS or localhost)
  if (!window.isSecureContext) {
    return {
      available: false,
      reason: 'Crypto API requires HTTPS or localhost',
      isWeChat,
    };
  }

  // Try to detect if importKey method exists
  if (typeof window.crypto.subtle.importKey !== 'function') {
    return {
      available: false,
      reason: 'crypto.subtle.importKey is not available',
      isWeChat,
    };
  }

  return {
    available: true,
    isWeChat,
  };
}

/**
 * Show user-friendly error message for unsupported browsers
 * @param {Object} supportInfo - Result from checkCryptoSupport()
 */
export function showCryptoNotSupportedDialog(supportInfo) {
  const isWeChat = supportInfo.isWeChat;

  const dialog = document.createElement('div');
  dialog.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 999999;
    padding: 20px;
  `;

  const content = document.createElement('div');
  content.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 24px;
    max-width: 500px;
    width: 100%;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  `;

  // Title
  const title = document.createElement('h2');
  title.textContent = '⚠️ Browser Not Supported';
  title.style.cssText = `
    margin: 0 0 16px 0;
    color: #333;
    font-size: 20px;
  `;

  // Message
  const message = document.createElement('p');
  message.style.cssText = `
    margin: 0 0 20px 0;
    color: #666;
    line-height: 1.6;
    font-size: 15px;
  `;

  if (isWeChat) {
    message.innerHTML = `
      <p style="margin: 0 0 12px 0;">WeChat's built-in browser does not support the encryption features required by this application.</p>
      <p style="margin: 0 0 12px 0;"><strong>To access this app:</strong></p>
      <ol style="margin: 0 0 12px 0; padding-left: 20px;">
        <li style="margin-bottom: 8px;">Tap the "···" menu in the top right corner</li>
        <li style="margin-bottom: 8px;">Select "Open in Browser"</li>
        <li>Use Safari, Chrome, or another browser</li>
      </ol>
      <p style="margin: 0; font-size: 13px; color: #999;">
        Or copy this link to another browser:<br>
        <code style="background: #f5f5f5; padding: 4px 8px; border-radius: 4px; display: inline-block; margin-top: 4px; word-break: break-all;">${window.location.href}</code>
      </p>
    `;
  } else {
    message.innerHTML = `
      <p style="margin: 0 0 12px 0;">This chat application requires Web Crypto API for end-to-end encryption.</p>
      <p style="margin: 0 0 12px 0;"><strong>Please use one of these browsers:</strong></p>
      <ul style="margin: 0; padding-left: 20px;">
        <li>Chrome (recommended)</li>
        <li>Firefox</li>
        <li>Safari</li>
        <li>Edge</li>
      </ul>
      <p style="margin: 12px 0 0 0; font-size: 13px; color: #999;">
        Technical reason: ${supportInfo.reason}
      </p>
    `;
  }

  // Buttons container
  const buttons = document.createElement('div');
  buttons.style.cssText = `
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  `;

  // Copy link button (for WeChat)
  if (isWeChat) {
    const copyButton = document.createElement('button');
    copyButton.textContent = '📋 Copy Link';
    copyButton.style.cssText = `
      padding: 10px 20px;
      border: 1px solid #ddd;
      background: white;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      color: #333;
      transition: all 0.2s;
    `;
    copyButton.onmouseover = () => {
      copyButton.style.background = '#f5f5f5';
    };
    copyButton.onmouseout = () => {
      copyButton.style.background = 'white';
    };
    copyButton.onclick = () => {
      // Try to copy to clipboard
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard
          .writeText(window.location.href)
          .then(() => {
            copyButton.textContent = '✅ Copied';
            setTimeout(() => {
              copyButton.textContent = '📋 Copy Link';
            }, 2000);
          })
          .catch(() => {
            alert('Please copy this link manually:\n' + window.location.href);
          });
      } else {
        // Fallback: show prompt
        prompt('Please copy this link:', window.location.href);
      }
    };
    buttons.appendChild(copyButton);
  }

  // Close button
  const closeButton = document.createElement('button');
  closeButton.textContent = 'I Understand';
  closeButton.style.cssText = `
    padding: 10px 20px;
    border: none;
    background: #0066cc;
    color: white;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.2s;
  `;
  closeButton.onmouseover = () => {
    closeButton.style.background = '#0052a3';
  };
  closeButton.onmouseout = () => {
    closeButton.style.background = '#0066cc';
  };
  closeButton.onclick = () => {
    document.body.removeChild(dialog);
    // Disable the room selector to prevent further errors
    const roomSelector = document.getElementById('room-selector');
    if (roomSelector) {
      roomSelector.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #999;">
          <h3 style="color: #666;">⚠️ Browser Not Compatible</h3>
          <p>Please use a supported browser</p>
        </div>
      `;
    }
  };

  buttons.appendChild(closeButton);

  content.appendChild(title);
  content.appendChild(message);
  content.appendChild(buttons);
  dialog.appendChild(content);
  document.body.appendChild(dialog);
}

/**
 * Initialize crypto compatibility check on app start
 * Attempts to load polyfill if native support is incomplete
 * @returns {Promise<boolean>} true if crypto is supported, false otherwise
 */
export async function initCryptoCompatCheck() {
  // First check if we need polyfill
  let supportInfo = checkCryptoSupport();

  if (!supportInfo.available) {
    console.warn(
      '⚠️ Native Crypto API incomplete, attempting to load polyfill...',
    );

    // Try to load polyfill
    try {
      const { loadCryptoPolyfill } = await import('./crypto-polyfill.js');
      const polyfillLoaded = await loadCryptoPolyfill();

      if (polyfillLoaded) {
        // Recheck support after polyfill is loaded
        supportInfo = checkCryptoSupport();
      }
    } catch (error) {
      console.error('❌ Failed to load crypto polyfill:', error);
    }
  }

  // Final check after polyfill attempt
  if (!supportInfo.available) {
    console.error(
      '❌ Crypto API not supported even with polyfill:',
      supportInfo,
    );
    // Show dialog after a short delay to ensure DOM is ready
    setTimeout(() => {
      showCryptoNotSupportedDialog(supportInfo);
    }, 100);
    return false;
  }

  // Crypto is available (either native or polyfilled)
  console.log('✅ Crypto API is supported');
  return true;
}

export default {
  checkCryptoSupport,
  showCryptoNotSupportedDialog,
  initCryptoCompatCheck,
};
