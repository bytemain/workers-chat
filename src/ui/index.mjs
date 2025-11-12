import CryptoUtils from '../common/crypto-utils.js';
import { keyManager } from '../common/key-manager.js';
import FileCrypto from '../common/file-crypto.js';
import { getCryptoPool } from './crypto-worker-pool.js';
import { createReactiveState } from './react/state.mjs';
import { api } from './api.mjs';
import { generateRandomUsername } from './utils/random.mjs';
import { isMobile } from './utils/device.mjs';
import tooltip from './tooltip.js';
import { updateRoomList } from './room-list.mjs';
import * as MobileUI from './mobile.mjs';
import { initCryptoCompatCheck } from '../common/crypto-compat.js';
import {
  MAX_MESSAGE_LENGTH,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_MB,
} from '../common/constants.mjs';
import {
  initPinnedMessages,
  togglePinnedPanel,
  pinMessage,
  getPinnedCount,
  handlePinUpdate,
} from './pinned-messages.mjs';
import { tryDecryptMessage } from './utils/message-crypto.mjs';
import { chatState, initChatState } from './utils/chat-state.mjs';
import { createTinybaseStorage } from './tinybase/index.mjs';
import { initMessageList } from './components/message-list.mjs';
import { initChannelList } from './components/channel-list.mjs';
import { listenReefEvent } from './utils/reef-helpers.mjs';

// Check Crypto API compatibility early
const cryptoSupported = initCryptoCompatCheck();
if (!cryptoSupported) {
  console.warn(
    '⚠️ Crypto API not supported, encryption features will be disabled',
  );
}

const cryptoPool = getCryptoPool();

// Configure marked.js for Markdown rendering (one-time setup)
if (typeof marked !== 'undefined') {
  marked.setOptions({
    breaks: true, // GFM line breaks
    gfm: true, // GitHub Flavored Markdown
    headerIds: false, // Don't generate header IDs
    mangle: false, // Don't escape email addresses
  });
  console.log('✅ Marked.js configured for Markdown rendering');
}

// Chat input component custom element
class ChatInputComponent extends HTMLElement {
  constructor() {
    super();
    this.onSubmit = null;
    this.onResize = null;
    this.onFileUpload = null;
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
  }

  render() {
    const placeholder = this.getAttribute('placeholder') || 'Type a message...';
    const minHeight = this.getAttribute('min-height') || '32px';
    const maxHeight = this.getAttribute('max-height') || '150px';
    const rows = this.getAttribute('rows') || '1';
    const showFileUpload = this.getAttribute('show-file-upload') === 'true';

    this.innerHTML = `
        <div class="chat-input-wrapper" style="
          display: flex;
          align-items: flex-end;
          position: relative;
          width: 100%;
        ">
          <textarea 
            class="chat-input-textarea" 
            rows="${rows}" 
            placeholder="${placeholder}"
            style="
              flex: 1;
              min-height: ${minHeight};
              max-height: ${maxHeight};
              padding: 8px;
              ${showFileUpload ? 'padding-right: 40px;' : ''}
              border: 1px solid #ddd;
              border-radius: 4px;
              resize: none;
              overflow-y: auto;
              font-family: Arial, Helvetica, sans-serif;
              font-size: 16px;
              line-height: 1.2;
              outline: none;
              box-sizing: border-box;
            "
          ></textarea>
          ${
            showFileUpload
              ? `
            <input 
              type="file" 
              class="chat-input-file" 
              multiple
              style="display: none;"
            >
            <input 
              type="file" 
              class="chat-input-media" 
              accept="image/*,video/*"
              multiple
              capture
              style="display: none;"
            >
            <i 
              class="ri-add-circle-line chat-input-add-btn" 
              title="Add attachment"
              style="
                position: absolute;
                right: 8px;
                bottom: 6px;
                width: 24px;
                height: 24px;
                cursor: pointer;
                font-size: 24px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: color 0.2s;
                color: #666;
              "
            ></i>
            <div class="chat-input-menu" style="
              display: none;
              position: absolute;
              right: 0;
              bottom: 45px;
              background: white;
              border: 1px solid #ddd;
              border-radius: 8px;
              box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
              overflow: hidden;
              z-index: 1000;
              min-width: 180px;
            ">
              <div class="menu-item upload-file" style="
                width: 100%;
                padding: 12px 16px;
                cursor: pointer;
                text-align: left;
                font-size: 14px;
                display: flex;
                align-items: center;
                gap: 10px;
                transition: background 0.2s;
              ">
                <i class="ri-attachment-line" style="font-size: 18px; color: #666;"></i>
                <span>Upload File</span>
              </div>
              <div class="menu-item upload-media" style="
                width: 100%;
                padding: 12px 16px;
                cursor: pointer;
                text-align: left;
                font-size: 14px;
                display: flex;
                align-items: center;
                gap: 10px;
                transition: background 0.2s;
                border-top: 1px solid #f0f0f0;
              ">
                <i class="ri-image-line" style="font-size: 18px; color: #666;"></i>
                <span>Image/Video</span>
              </div>
            </div>
          `
              : ''
          }
        </div>
      `;

    this.textarea = this.querySelector('.chat-input-textarea');
    this.fileInput = this.querySelector('.chat-input-file');
    this.mediaInput = this.querySelector('.chat-input-media');
    this.addBtn = this.querySelector('.chat-input-add-btn');
    this.menu = this.querySelector('.chat-input-menu');
  }

  setupEventListeners() {
    if (!this.textarea) return;

    // Track composition state for IME input (Chinese, Japanese, etc.)
    let isComposing = false;

    this.textarea.addEventListener('compositionstart', () => {
      isComposing = true;
    });

    this.textarea.addEventListener('compositionend', () => {
      isComposing = false;
    });

    // Handle Enter key (submit on Enter, new line on Shift+Enter)
    // Check our own isComposing flag to avoid sending during IME composition
    this.textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !isComposing) {
        event.preventDefault();
        this.submit();
        return;
      }

      // Clear reply when ESC is pressed
      if (event.key === 'Escape' && currentReplyTo) {
        event.preventDefault();
        clearReplyTo();
        return;
      }
    });

    // Auto-resize on input
    this.textarea.addEventListener('input', () => {
      this.autoResize();
    });

    // Add button click - toggle menu
    if (this.addBtn && this.menu) {
      this.addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = this.menu.style.display === 'block';
        this.menu.style.display = isVisible ? 'none' : 'block';
      });

      // Add hover effect
      this.addBtn.addEventListener('mouseenter', () => {
        this.addBtn.style.color = '#333';
      });
      this.addBtn.addEventListener('mouseleave', () => {
        this.addBtn.style.color = '#666';
      });

      // Close menu when clicking outside
      document.addEventListener('click', (e) => {
        if (this.menu && !this.contains(e.target)) {
          this.menu.style.display = 'none';
        }
      });

      // Menu item: Upload File
      const uploadFileBtn = this.menu.querySelector('.upload-file');
      if (uploadFileBtn) {
        uploadFileBtn.addEventListener('click', () => {
          if (this.fileInput) {
            this.fileInput.click();
          }
          this.menu.style.display = 'none';
        });
        uploadFileBtn.addEventListener('mouseenter', () => {
          uploadFileBtn.style.background = '#f5f5f5';
        });
        uploadFileBtn.addEventListener('mouseleave', () => {
          uploadFileBtn.style.background = 'white';
        });
      }

      // Menu item: Upload Media
      const uploadMediaBtn = this.menu.querySelector('.upload-media');
      if (uploadMediaBtn) {
        uploadMediaBtn.addEventListener('click', () => {
          if (this.mediaInput) {
            this.mediaInput.click();
          }
          this.menu.style.display = 'none';
        });
        uploadMediaBtn.addEventListener('mouseenter', () => {
          uploadMediaBtn.style.background = '#f5f5f5';
        });
        uploadMediaBtn.addEventListener('mouseleave', () => {
          uploadMediaBtn.style.background = 'white';
        });
      }
    }

    // File input change (all files)
    if (this.fileInput) {
      this.fileInput.addEventListener('change', async (event) => {
        if (!event.target.files || event.target.files.length === 0) return;

        await Promise.all(
          Array.from(event.target.files).map(async (file) => {
            if (this.onFileUpload) {
              await this.onFileUpload(file);
            }
          }),
        );

        this.fileInput.value = '';
      });
    }

    // Media input change (images/videos)
    if (this.mediaInput) {
      this.mediaInput.addEventListener('change', async (event) => {
        if (!event.target.files || event.target.files.length === 0) return;

        await Promise.all(
          Array.from(event.target.files).map(async (file) => {
            if (this.onFileUpload) {
              await this.onFileUpload(file);
            }
          }),
        );

        this.mediaInput.value = '';
      });
    }
  }

  autoResize() {
    if (!this.textarea) return;

    const maxHeight = parseInt(this.getAttribute('max-height')) || 150;

    this.textarea.style.height = 'auto';
    let newHeight = Math.min(this.textarea.scrollHeight, maxHeight);
    this.textarea.style.height = newHeight + 'px';

    // Icon doesn't need height adjustment - it stays fixed

    // Notify parent about resize
    if (this.onResize) {
      this.onResize(newHeight);
    }

    // Dispatch custom event
    this.dispatchEvent(
      new CustomEvent('resize', { detail: { height: newHeight } }),
    );
  }

  submit() {
    if (!this.textarea) return;

    const message = this.textarea.value.trim();
    if (message.length > 0) {
      if (this.onSubmit) {
        this.onSubmit(message);
      }

      // Dispatch custom event
      this.dispatchEvent(new CustomEvent('submit', { detail: { message } }));

      // Clear input and reset height
      this.clear();
    }
  }

  clear() {
    if (this.textarea) {
      this.textarea.value = '';
      this.autoResize();
    }
  }

  getValue() {
    return this.textarea ? this.textarea.value : '';
  }

  setValue(value) {
    if (this.textarea) {
      this.textarea.value = value;
      this.autoResize();
    }
  }

  focus() {
    if (this.textarea) {
      this.textarea.focus();
    }
  }

  // Handle paste events for files
  onPaste(handler) {
    if (this.textarea) {
      this.textarea.addEventListener('paste', handler);
    }
  }
}
customElements.define('chat-input-component', ChatInputComponent);

// System message custom element
class SystemMessage extends HTMLElement {
  connectedCallback() {
    this.render();
  }
  render() {
    const message = this.getAttribute('message');
    this.innerHTML = '';
    const sysSpan = document.createElement('span');
    sysSpan.className = 'system-message';
    sysSpan.textContent = message;
    sysSpan.style.color = '#888';
    sysSpan.style.fontStyle = 'italic';
    this.appendChild(sysSpan);
  }
}
customElements.define('system-message', SystemMessage);

// Lazy loading image custom element
class LazyImg extends HTMLElement {
  constructor() {
    super();
    this.observer = null;
    this.loaded = false;
    this._decryptedObjectUrl = null; // Store decrypted blob URL for cleanup
  }

  connectedCallback() {
    // Get attributes
    const src = this.getAttribute('data-src');
    const alt = this.getAttribute('alt') || '';
    const maxWidth = this.getAttribute('max-width') || '300px';
    const maxHeight = this.getAttribute('max-height') || '300px';
    const isEncrypted = this.getAttribute('encrypted') === 'true';
    const fileName = this.getAttribute('file-name') || 'image';

    // Store attributes
    this._realSrc = src;
    this._isEncrypted = isEncrypted;
    this._fileName = fileName;
    this._maxWidth = maxWidth;
    this._maxHeight = maxHeight;

    // Create placeholder container
    const placeholder = document.createElement('div');
    placeholder.style.cssText = `
      width: ${maxWidth};
      max-width: ${maxWidth};
      height: 200px;
      max-height: ${maxHeight};
      background: ${isEncrypted ? '#f5f5f5' : '#f0f0f0'};
      border: 2px dashed ${isEncrypted ? '#999' : '#ccc'};
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      margin-top: 5px;
      cursor: ${isEncrypted && !isRoomEncrypted ? 'default' : 'pointer'};
    `;

    if (isEncrypted && !isRoomEncrypted) {
      // Encrypted but no key available
      placeholder.innerHTML = `
        <div style="font-size: 48px;">🔒</div>
        <div style="margin-top: 8px; color: #999;">Encrypted Image</div>
        <div style="margin-top: 4px; font-size: 12px; color: #999;">No decryption key available</div>
      `;
    } else if (isEncrypted) {
      // Encrypted with key - will decrypt on load
      placeholder.innerHTML = `
        <div style="font-size: 48px;">🔓</div>
        <div style="margin-top: 8px; color: #666;">Loading...</div>
      `;
    } else {
      // Not encrypted
      placeholder.innerHTML = `
        <div style="font-size: 48px; color: #999;">📷</div>
        <div style="margin-top: 8px; color: #999;">Loading...</div>
      `;
    }

    this._placeholder = placeholder;
    this.appendChild(placeholder);

    // Only setup lazy loading if we can display the image
    if (!isEncrypted || (isEncrypted && isRoomEncrypted && currentRoomKey)) {
      this.setupLazyLoading();
    }
  }

  setupLazyLoading() {
    // Check if IntersectionObserver is supported
    if (!('IntersectionObserver' in window)) {
      // Fallback: load image immediately if IntersectionObserver is not supported
      this.loadImage();
      return;
    }

    // Create observer
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          // If the image is in the viewport
          if (entry.isIntersecting) {
            this.loadImage();
            // Stop observing after loading
            this.observer.unobserve(this);
          }
        });
      },
      {
        // Start loading when image is 100px away from viewport
        rootMargin: '100px',
        threshold: 0.01,
      },
    );

    // Start observing
    this.observer.observe(this);
  }

  async loadImage() {
    if (this.loaded || !this._realSrc) return;

    const placeholder = this._placeholder;

    try {
      if (this._isEncrypted && isRoomEncrypted && currentRoomKey) {
        // Decrypt encrypted image
        console.log('🔓 Lazy-decrypting image...');

        placeholder.innerHTML = `
          <div style="font-size: 48px;">🔓</div>
          <div style="margin-top: 8px; color: #666;">Decrypting...</div>
        `;

        const result = await FileCrypto.downloadAndDecrypt(
          this._realSrc,
          currentRoomKey,
          (progress, stage) => {
            placeholder.innerHTML = `
              <div style="font-size: 32px;">🔓</div>
              <div style="margin-top: 8px; color: #666;">${stage}: ${Math.round(progress)}%</div>
            `;
          },
        );

        // Create object URL from decrypted blob
        const objectUrl = URL.createObjectURL(result.blob);
        this._decryptedObjectUrl = objectUrl;

        // Create and display the image
        const img = document.createElement('img');
        img.src = objectUrl;
        img.alt = this._fileName;
        img.style.maxWidth = this._maxWidth;
        img.style.maxHeight = this._maxHeight;
        img.style.display = 'block';
        img.style.marginTop = '5px';
        img.style.cursor = 'pointer';
        img.onclick = () => window.open(objectUrl, '_blank');

        this.replaceChild(img, placeholder);
        this.loaded = true;
        console.log('✅ Image lazy-decrypted and displayed');

        // Handle scroll position maintenance
        this._handleScrollMaintenance(img);
      } else {
        // Load non-encrypted image normally
        const tempImg = new Image();

        tempImg.onload = () => {
          const img = document.createElement('img');
          img.src = this._realSrc;
          img.alt = this._fileName;
          img.style.maxWidth = this._maxWidth;
          img.style.maxHeight = this._maxHeight;
          img.style.display = 'block';
          img.style.marginTop = '5px';
          img.style.cursor = 'pointer';
          img.onclick = () => window.open(this._realSrc, '_blank');

          this.replaceChild(img, placeholder);
          this.loaded = true;

          // Handle scroll position maintenance
          this._handleScrollMaintenance(img);

          // Dispatch loaded event
          this.dispatchEvent(
            new CustomEvent('lazy-loaded', { detail: { src: this._realSrc } }),
          );
        };

        tempImg.onerror = () => {
          console.warn('Failed to load lazy image:', this._realSrc);
          placeholder.innerHTML = `
            <div style="font-size: 32px; color: #cc0000;">❌</div>
            <div style="margin-top: 8px; color: #cc0000;">Load Failed</div>
          `;
          placeholder.style.background = '#ffeeee';
          placeholder.style.cursor = 'default';
        };

        // Start loading
        tempImg.src = this._realSrc;
      }
    } catch (error) {
      console.error('❌ Failed to load/decrypt image:', error);
      placeholder.innerHTML = `
        <div style="font-size: 32px; color: #cc0000;">❌</div>
        <div style="margin-top: 8px; color: #cc0000;">Failed to decrypt</div>
      `;
      placeholder.style.background = '#ffeeee';
    }
  }

  _handleScrollMaintenance(img) {
    const isInThreadPanel = this.closest('#thread-panel') !== null;
    const scrollContainer = isInThreadPanel
      ? document.querySelector('#thread-replies')
      : document.querySelector('#chatlog');

    if (scrollContainer) {
      const shouldScroll = isInThreadPanel
        ? () => {
            const container = document.querySelector('#thread-replies');
            return (
              container &&
              Math.abs(
                container.scrollTop +
                  container.clientHeight -
                  container.scrollHeight,
              ) < 2
            );
          }
        : () => window.isAtBottom;

      if (window.setupImageScrollHandler) {
        window.setupImageScrollHandler(img, scrollContainer, shouldScroll);
      } else {
        if (shouldScroll()) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
      }
    }
  }

  disconnectedCallback() {
    // Clean up observer when element is removed
    if (this.observer) {
      this.observer.disconnect();
    }

    // Clean up decrypted blob URL to prevent memory leaks
    if (this._decryptedObjectUrl) {
      URL.revokeObjectURL(this._decryptedObjectUrl);
      this._decryptedObjectUrl = null;
    }
  }
}
customElements.define('lazy-img', LazyImg);

// File message custom element (for non-image files)
class FileMessage extends HTMLElement {
  connectedCallback() {
    this.render();
  }

  render() {
    const fileUrl = this.getAttribute('file-url');
    const fileName = this.getAttribute('file-name') || 'file';
    const isEncrypted = this.getAttribute('encrypted') === 'true';

    // Clear existing content
    this.innerHTML = '';

    // Create download link
    const link = document.createElement('a');
    link.textContent = '📎 ' + fileName;
    link.style.cursor = 'pointer';
    link.style.color = '#0066cc';
    link.style.textDecoration = 'underline';

    if (isEncrypted && isRoomEncrypted && currentRoomKey) {
      // Encrypted file - decrypt on click
      link.onclick = async (e) => {
        e.preventDefault();
        const originalText = link.textContent;
        try {
          link.textContent = '⏳ Decrypting...';
          console.log('🔓 Decrypting file...');

          const result = await FileCrypto.downloadAndDecrypt(
            fileUrl,
            currentRoomKey,
            (progress, stage) => {
              link.textContent = `⏳ ${stage}: ${Math.round(progress)}%`;
            },
          );

          // Create download
          const objectUrl = URL.createObjectURL(result.blob);
          const a = document.createElement('a');
          a.href = objectUrl;
          a.download = result.metadata.fileName || fileName;
          a.click();
          URL.revokeObjectURL(objectUrl);

          link.textContent = originalText;
          console.log('✅ File decrypted and downloaded');
        } catch (error) {
          console.error('❌ Failed to decrypt file:', error);
          link.textContent = originalText + ' (decryption failed)';
        }
      };
    } else if (isEncrypted && !isRoomEncrypted) {
      // Encrypted file but no key - show locked indicator
      link.style.cursor = 'default';
      link.style.color = '#999';
      link.textContent = '🔒 ' + fileName + ' (encrypted)';
      link.title = 'No decryption key available';
      link.onclick = (e) => {
        e.preventDefault();
        alert(
          'This file is encrypted. You need the correct encryption key to download it.',
        );
      };
    } else {
      // Non-encrypted file - normal download
      link.href = fileUrl;
      link.download = fileName;
      link.target = '_blank';
    }

    this.appendChild(link);
  }
}
customElements.define('file-message', FileMessage);

// Define custom element for chat messages
class ChatMessage extends HTMLElement {
  connectedCallback() {
    this.render();
  }

  render() {
    const username = this.getAttribute('username');
    const message = this.getAttribute('message');
    const timestamp = this.getAttribute('timestamp');
    const messageId = this.getAttribute('message-id');
    const replyTo = this.getAttribute('reply-to');
    const threadCount = this.getAttribute('thread-count') || '0';
    const isInThread = this.getAttribute('is-in-thread') === 'true';
    const editedAt = this.getAttribute('edited-at');

    // Clear existing content
    this.innerHTML = '';

    // Check if previous message is from the same user
    const wrapper = this.closest('.message-wrapper');
    let showUsername = true;
    if (wrapper) {
      const prevWrapper = wrapper.previousElementSibling;
      if (prevWrapper && prevWrapper.classList.contains('message-wrapper')) {
        const prevMessage = prevWrapper.querySelector('chat-message');
        if (prevMessage) {
          const prevUsername = prevMessage.getAttribute('username');
          const prevTimestamp = prevMessage.getAttribute('timestamp');
          // Hide username if same user and within 5 minutes
          if (prevUsername === username && timestamp && prevTimestamp) {
            const timeDiff = Number(timestamp) - Number(prevTimestamp);
            if (timeDiff < 5 * 60 * 1000) {
              // 5 minutes
              showUsername = false;
            }
          }
        }
      }
    }

    // Create main container with avatar and content side by side
    const messageContainer = document.createElement('div');
    messageContainer.className = 'msg-container';
    messageContainer.style.display = 'flex';
    messageContainer.style.gap = '10px';

    // Add username with avatar if present and should be shown
    if (username && showUsername) {
      // Add avatar
      const avatar = document.createElement('playful-avatar');
      avatar.setAttribute('name', username);
      avatar.setAttribute('variant', 'beam');
      avatar.className = 'msg-avatar';
      messageContainer.appendChild(avatar);

      // Create right side content container
      const rightContent = document.createElement('div');
      rightContent.className = 'msg-right-content';
      rightContent.style.flex = '1';
      rightContent.style.minWidth = '0';

      // Add username and time in a header
      const userHeader = document.createElement('div');
      userHeader.className = 'msg-user-header';
      userHeader.style.display = 'flex';
      userHeader.style.alignItems = 'baseline';
      userHeader.style.gap = '8px';
      userHeader.style.marginBottom = '2px';

      const usernameSpan = document.createElement('span');
      usernameSpan.className = 'username';
      usernameSpan.textContent = username;
      usernameSpan.style.fontWeight = 'bold';
      userHeader.appendChild(usernameSpan);

      // Add time next to username
      if (timestamp) {
        const timeSpan = document.createElement('span');
        timeSpan.className = 'msg-time-outside-actions';
        timeSpan.textContent = formatTimestamp(timestamp);
        timeSpan.style.color = '#888';
        timeSpan.style.fontSize = '0.85em';
        timeSpan.style.whiteSpace = 'nowrap';
        timeSpan.setAttribute('data-first-message', 'true');
        userHeader.appendChild(timeSpan);
      }

      rightContent.appendChild(userHeader);

      // Create message content container
      const contentDiv = document.createElement('div');
      contentDiv.className = 'msg-content';
      contentDiv.style.wordWrap = 'break-word';
      contentDiv.style.lineHeight = '1.4';

      // Store reference to contentDiv for rendering methods
      this._contentDiv = contentDiv;

      // Handle file messages (check inside the element)
      if (message.startsWith('FILE:')) {
        this.renderFileMessage(message, contentDiv);
      } else {
        // Handle regular text messages with link detection
        this.renderTextMessage(message, contentDiv);
      }

      rightContent.appendChild(contentDiv);
      messageContainer.appendChild(rightContent);
    } else {
      // No username shown - just content with left padding
      const contentDiv = document.createElement('div');
      contentDiv.className = 'msg-content';
      contentDiv.style.wordWrap = 'break-word';
      contentDiv.style.lineHeight = '1.4';
      contentDiv.style.paddingLeft = '46px'; // Align with messages that have avatar

      // Store reference to contentDiv for rendering methods
      this._contentDiv = contentDiv;

      // Handle file messages (check inside the element)
      if (message.startsWith('FILE:')) {
        this.renderFileMessage(message, contentDiv);
      } else {
        // Handle regular text messages with link detection
        this.renderTextMessage(message, contentDiv);
      }

      messageContainer.appendChild(contentDiv);
    }

    this.appendChild(messageContainer);

    // Get contentDiv for adding reply references and other content
    const contentDiv = this.querySelector('.msg-content');

    // Add "(edited)" indicator if message was edited
    if (editedAt) {
      const editedSpan = document.createElement('span');
      editedSpan.className = 'msg-edited-indicator';
      editedSpan.textContent = ' (edited)';
      editedSpan.style.color = '#888';
      editedSpan.style.fontSize = '0.75em';
      editedSpan.style.fontStyle = 'italic';
      editedSpan.style.marginLeft = '4px';
      editedSpan.title = `Edited at ${formatTimestamp(editedAt)}`;
      contentDiv.appendChild(editedSpan);
    }

    // Add reply reference if this is a reply and not in thread view
    if (replyTo && !isInThread) {
      try {
        const replyData = JSON.parse(replyTo);
        const replyRef = document.createElement('div');
        replyRef.className = 'reply-reference';
        replyRef.innerHTML = `
            <span class="reply-icon">Reply to</span>
            <span class="reply-author">${replyData.username}</span>
            <span class="reply-separator">:</span>
            <span class="reply-preview">${replyData.preview}</span>
          `;
        replyRef.onclick = () => {
          // Scroll to and highlight the original message
          const originalMsg = document.querySelector(
            `[data-message-id="${replyData.messageId}"]`,
          );
          if (originalMsg) {
            originalMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
            originalMsg.style.background = '#fff3cd';
            setTimeout(() => {
              originalMsg.style.background = '';
            }, 2000);
          }
          // Open the thread for the referenced message
          window.openThread(replyData.messageId);
        };
        contentDiv.appendChild(replyRef);
      } catch (e) {
        console.error('Failed to parse replyTo:', e);
      }
    }

    // Add thread indicator if there are replies
    if (parseInt(threadCount) > 0) {
      const threadIndicator = document.createElement('div');
      threadIndicator.className = 'thread-indicator';
      threadIndicator.innerHTML = `💬 ${threadCount} ${parseInt(threadCount) === 1 ? 'reply' : 'replies'}`;
      threadIndicator.onclick = (e) => {
        e.stopPropagation();
        if (messageId) {
          window.openThread(messageId);
        }
      };
      contentDiv.appendChild(threadIndicator);
    }
  }

  renderFileMessage(message, container) {
    const parts = message.substring(5).split('|');
    const fileUrl = parts[0];
    const fileName = parts[1] || 'file';
    const fileType = parts[2] || '';
    const isEncrypted = parts[3] === 'encrypted';

    // If it's an image, use lazy-img component
    if (fileType.startsWith('image/')) {
      const lazyImg = document.createElement('lazy-img');
      lazyImg.setAttribute('data-src', fileUrl);
      lazyImg.setAttribute('alt', fileName);
      lazyImg.setAttribute('file-name', fileName);
      lazyImg.setAttribute('max-width', '300px');
      lazyImg.setAttribute('max-height', '300px');

      if (isEncrypted) {
        lazyImg.setAttribute('encrypted', 'true');
      }

      container.appendChild(lazyImg);
    } else {
      // For other files, use file-message component
      const fileMessage = document.createElement('file-message');
      fileMessage.setAttribute('file-url', fileUrl);
      fileMessage.setAttribute('file-name', fileName);

      if (isEncrypted) {
        fileMessage.setAttribute('encrypted', 'true');
      }

      container.appendChild(fileMessage);
    }
  }

  renderTextMessage(text, container) {
    // Check if marked and DOMPurify are available
    if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
      // Fallback to plain text rendering
      this.renderPlainTextMessage(text, container);
      return;
    }

    // Simple heuristic to detect if text contains Markdown syntax
    const hasMarkdown = /[*_`[\]#>~\-]|\n\n/.test(text);

    if (!hasMarkdown) {
      // Fast path: no Markdown detected, use plain text rendering
      this.renderPlainTextMessage(text, container);
      return;
    }

    try {
      // Parse Markdown
      const rawHtml = marked.parse(text);

      // Sanitize HTML with DOMPurify
      const cleanHtml = DOMPurify.sanitize(rawHtml, {
        ALLOWED_TAGS: [
          'p',
          'br',
          'strong',
          'b',
          'em',
          'i',
          'code',
          'pre',
          'a',
          'ul',
          'ol',
          'li',
          'blockquote',
          'h1',
          'h2',
          'h3',
          'h4',
          'h5',
          'h6',
          'del',
          'hr',
          'table',
          'thead',
          'tbody',
          'tr',
          'th',
          'td',
          'img',
        ],
        ALLOWED_ATTR: [
          'href',
          'target',
          'rel',
          'class',
          'src',
          'alt',
          'loading',
        ],
        ALLOWED_URI_REGEXP:
          /^(?:(?:(?:f|ht)tps?|mailto|tel|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
      });

      // Create a wrapper div for markdown content
      const markdownDiv = document.createElement('div');
      markdownDiv.className = 'message-markdown';
      markdownDiv.innerHTML = cleanHtml;

      // Post-process: ensure all links open in new tab
      markdownDiv.querySelectorAll('a').forEach((link) => {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.style.color = '#0066cc';
      });

      // Post-process: handle channel links (e.g., #channel-name)
      this.processChannelLinks(markdownDiv);

      container.appendChild(markdownDiv);
    } catch (error) {
      console.error('Error rendering markdown:', error);
      // Fallback to plain text on error
      this.renderPlainTextMessage(text, container);
    }
  }

  // Process channel links in markdown content
  processChannelLinks(container) {
    const channelRegex = /#([a-zA-Z0-9_\-\u4e00-\u9fa5]{2,32})/g;
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      null,
      false,
    );

    const textNodes = [];
    while (walker.nextNode()) {
      // Skip text nodes inside code blocks
      if (
        walker.currentNode.parentElement.tagName === 'CODE' ||
        walker.currentNode.parentElement.tagName === 'PRE'
      ) {
        continue;
      }
      textNodes.push(walker.currentNode);
    }

    textNodes.forEach((textNode) => {
      const text = textNode.textContent;
      if (!channelRegex.test(text)) return;

      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      channelRegex.lastIndex = 0;
      let match;

      while ((match = channelRegex.exec(text)) !== null) {
        // Add text before match
        if (match.index > lastIndex) {
          fragment.appendChild(
            document.createTextNode(text.substring(lastIndex, match.index)),
          );
        }

        // Create channel link
        const channelName = match[1];
        const channelLink = document.createElement('a');
        channelLink.href = '#';
        channelLink.className = 'channel-link';
        channelLink.textContent = '#' + channelName;
        channelLink.dataset.channel = channelName;
        channelLink.style.color = '#1da1f2';
        channelLink.style.fontWeight = '500';
        channelLink.style.textDecoration = 'none';
        channelLink.style.cursor = 'pointer';
        channelLink.style.padding = '0 2px';
        channelLink.style.borderRadius = '2px';
        channelLink.style.transition = 'background-color 0.2s';

        channelLink.addEventListener('mouseenter', () => {
          channelLink.style.backgroundColor = '#e8f5fd';
          channelLink.style.textDecoration = 'underline';
        });
        channelLink.addEventListener('mouseleave', () => {
          channelLink.style.backgroundColor = 'transparent';
          channelLink.style.textDecoration = 'none';
        });

        channelLink.addEventListener('click', (e) => {
          e.preventDefault();
          window.switchToChannel(channelName);
        });

        fragment.appendChild(channelLink);
        lastIndex = match.index + match[0].length;
      }

      // Add remaining text
      if (lastIndex < text.length) {
        fragment.appendChild(
          document.createTextNode(text.substring(lastIndex)),
        );
      }

      textNode.replaceWith(fragment);
    });
  }

  // Plain text rendering (original logic)
  renderPlainTextMessage(text, container) {
    // Helper function to add text with preserved newlines
    const addTextWithNewlines = (textContent) => {
      const lines = textContent.split('\n');
      lines.forEach((line, index) => {
        if (line) {
          container.appendChild(document.createTextNode(line));
        }
        if (index < lines.length - 1) {
          container.appendChild(document.createElement('br'));
        }
      });
    };

    // Create patterns for URLs and channels
    // Note: We need to match them separately to avoid regex group index confusion
    const patterns = [
      {
        type: 'url',
        regex: /(https?:\/\/[^\s]+)/g,
        handler: (match) => {
          const link = document.createElement('a');
          link.href = match;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = match;
          link.style.color = '#0066cc';
          link.style.textDecoration = 'underline';
          return link;
        },
      },
      {
        type: 'www',
        regex: /(www\.[^\s]+)/g,
        handler: (match) => {
          const link = document.createElement('a');
          link.href = 'https://' + match;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = match;
          link.style.color = '#0066cc';
          link.style.textDecoration = 'underline';
          return link;
        },
      },
      {
        type: 'channel',
        regex: /#([a-zA-Z0-9_\-\u4e00-\u9fa5]{2,32})/g,
        handler: (match, channelName) => {
          const channelLink = document.createElement('a');
          channelLink.href = '#';
          channelLink.className = 'channel-link';
          channelLink.textContent = '#' + channelName;
          channelLink.dataset.channel = channelName;
          channelLink.style.color = '#1da1f2';
          channelLink.style.fontWeight = '500';
          channelLink.style.textDecoration = 'none';
          channelLink.style.cursor = 'pointer';
          channelLink.style.padding = '0 2px';
          channelLink.style.borderRadius = '2px';
          channelLink.style.transition = 'background-color 0.2s';

          channelLink.addEventListener('mouseenter', () => {
            channelLink.style.backgroundColor = '#e8f5fd';
            channelLink.style.textDecoration = 'underline';
          });
          channelLink.addEventListener('mouseleave', () => {
            channelLink.style.backgroundColor = 'transparent';
            channelLink.style.textDecoration = 'none';
          });

          channelLink.addEventListener('click', (e) => {
            e.preventDefault();
            window.switchToChannel(channelName);
          });

          return channelLink;
        },
      },
    ];

    // Find all matches across all patterns
    const matches = [];
    patterns.forEach((pattern) => {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match;
      while ((match = regex.exec(text)) !== null) {
        matches.push({
          type: pattern.type,
          index: match.index,
          length: match[0].length,
          fullMatch: match[0],
          captureGroup: match[1], // For channel name
          handler: pattern.handler,
        });
      }
    });

    // Sort matches by index
    matches.sort((a, b) => a.index - b.index);

    // Remove overlapping matches (keep the first one)
    const filteredMatches = [];
    let lastEnd = 0;
    matches.forEach((match) => {
      if (match.index >= lastEnd) {
        filteredMatches.push(match);
        lastEnd = match.index + match.length;
      }
    });

    // Build the output
    let lastIndex = 0;
    filteredMatches.forEach((match) => {
      // Add text before the match
      if (match.index > lastIndex) {
        addTextWithNewlines(text.substring(lastIndex, match.index));
      }

      // Add the matched element (URL or channel link)
      if (match.type === 'channel') {
        container.appendChild(
          match.handler(match.fullMatch, match.captureGroup),
        );
      } else {
        container.appendChild(match.handler(match.fullMatch));
      }

      lastIndex = match.index + match.length;
    });

    // Add remaining text after last match
    if (lastIndex < text.length) {
      addTextWithNewlines(text.substring(lastIndex));
    }
  }
}

// Register the custom element
customElements.define('chat-message', ChatMessage);

let currentWebSocket = null;

let chatroom = document.querySelector('#chatroom');
let chatlog = document.querySelector('#chatlog');
let chatInputComponent = null; // Will be initialized after DOM is ready
let roster = document.querySelector('#roster');

// Connection status element
let connectionStatus = document.querySelector('#connection-status');

// Thread panel elements
let threadPanel = document.querySelector('#thread-panel');
let threadClose = document.querySelector('#thread-close');
let threadOriginalMessage = document.querySelector('#thread-original-message');
let threadReplies = document.querySelector('#thread-replies');
let threadInputComponent = null; // Will be initialized after DOM is ready

// Reply indicator elements
let replyIndicator = document.querySelector('#reply-indicator');
let replyIndicatorClose = replyIndicator.querySelector(
  '.reply-indicator-close',
);

// Is the chatlog scrolled to the bottom?
let isAtBottom = true;

let username;
let roomname;
let currentChannel = 'general'; // Current channel for sending messages (DEPRECATED: use chatState)
let currentThreadId = null; // Current thread ID (DEPRECATED: use chatState)
let allChannels = []; // Cache of all channels
let temporaryChannels = new Set(); // Track frontend-only temporary channels

// Backward compatibility: Sync global variables with chatState
// These will be removed after full migration
Object.defineProperty(window, 'currentChannel', {
  get() {
    return chatState?.value?.channel || currentChannel;
  },
  set(v) {
    currentChannel = v;
    if (chatState) {
      chatState.switchChannel(v);
    }
  },
  configurable: true,
});

Object.defineProperty(window, 'currentThreadId', {
  get() {
    return chatState?.value?.threadId || currentThreadId;
  },
  set(v) {
    currentThreadId = v;
    if (chatState) {
      v ? chatState.openThread(v) : chatState.closeThread();
    }
  },
  configurable: true,
});

// Export to window for use by other modules
window.currentRoomName = null;
window.currentUsername = null;

// E2EE state variables
const { state: encryptionState, subscribe: subscribeEncryption } =
  createReactiveState({
    roomKey: null, // Current room encryption key
    isEncrypted: false, // Whether current room is encrypted
    initialized: false, // Whether encryption has been initialized for this session
    dialogOpen: false, // Prevent multiple password dialogs
  });

// Export encryption state to window for use by other modules
window.encryptionState = encryptionState;

// Backward compatibility getters (temporary during migration)
let currentRoomKey = null;
let isRoomEncrypted = false;

// Setup encryption state listener - auto update UI when encryption state changes
subscribeEncryption((property, newValue, oldValue) => {
  console.log(`🔐 Encryption state changed: ${property} = ${newValue}`);

  // Sync backward compatibility variables
  currentRoomKey = encryptionState.roomKey;
  isRoomEncrypted = encryptionState.isEncrypted;

  // Auto update UI when key or encryption status changes
  if (['roomKey', 'isEncrypted'].includes(property)) {
    updateEncryptionUI();
  }

  // Log initialization completion
  if (property === 'initialized' && newValue === true) {
    console.log('✅ Encryption initialization completed');
  }
});

// Helper function to setup image load handlers for maintaining scroll position
function setupImageScrollHandler(img, scrollContainer, shouldScrollToBottom) {
  img.addEventListener('load', () => {
    if (shouldScrollToBottom && shouldScrollToBottom()) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
  });

  // Also handle error case to prevent hanging
  img.addEventListener('error', () => {
    console.warn('Image failed to load:', img.src);
  });
}
window.setupImageScrollHandler = setupImageScrollHandler;

// Connection status tracking
let connectionStatusTimeout = null;

// Update connection status indicator
function updateConnectionStatus(status) {
  // Clear any existing timeout
  if (connectionStatusTimeout) {
    clearTimeout(connectionStatusTimeout);
    connectionStatusTimeout = null;
  }
  if (!connectionStatus) {
    return;
  }

  // Remove all status classes
  connectionStatus.classList.remove('connected', 'reconnecting', 'error');

  switch (status) {
    case 'connected':
      connectionStatus.style.display = ''; // Reset to use CSS class
      connectionStatus.classList.add('connected');
      connectionStatus.textContent = 'Connected';
      // Hide after 2 seconds
      connectionStatusTimeout = setTimeout(() => {
        connectionStatus.classList.remove('connected');
        connectionStatus.style.display = 'none';
      }, 2000);
      break;

    case 'reconnecting':
      connectionStatus.style.display = ''; // Reset to use CSS class
      connectionStatus.classList.add('reconnecting');
      connectionStatus.textContent = 'Reconnecting...';
      break;

    case 'error':
      connectionStatus.style.display = ''; // Reset to use CSS class
      connectionStatus.classList.add('error');
      connectionStatus.textContent = 'Connection Error';
      break;

    default:
      connectionStatus.style.display = 'none';
  }
}

// Format timestamp to readable string (Chinese format)
function formatTimestamp(timestamp) {
  const date = new Date(Number(timestamp));
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day} ${hh}:${mm}`;
}

// Thread state
// Note: currentThreadId is now managed by chatState (see line ~1307)
let messagesCache = new Map(); // messageId -> message data

// Reply state for main chat input
let currentReplyTo = null; // {messageId, username, preview, rootMessageId}

// Generate message ID from timestamp and username for legacy messages
function generateLegacyMessageId(timestamp, username) {
  return `${timestamp}-${username}`;
}

/**
 * Format file size in bytes to human-readable format
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted file size
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

// ===== E2EE Helper Functions =====

/**
 * Verify room password by attempting to decrypt verification data
 * @param {string} roomId - Room ID
 * @param {string} password - Password to verify
 * @param {string} verificationData - Encrypted verification data
 * @returns {Promise<Object>} {success: boolean, key?: CryptoKey, error?: string}
 */
/**
 * Show encryption key input dialog
 * @param {Object} roomData - Room information (only uses name)
 * @returns {Promise<string|null>} Entered key or null if cancelled
 */
function showPasswordDialog(roomData, currentPassword = null) {
  // Prevent multiple dialogs from opening
  if (encryptionState.dialogOpen) {
    console.log('⚠️ Password dialog already open, ignoring request');
    return Promise.resolve(null);
  }

  encryptionState.dialogOpen = true;

  return new Promise((resolve) => {
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    `;

    // Show current key section if exists
    const currentKeySection = currentPassword
      ? `
      <div style="
        margin: 0 0 16px 0;
        padding: 12px;
        background: #f5f5f5;
        border-radius: 4px;
        border: 1px solid #ddd;
      ">
        <p style="margin: 0 0 4px 0; font-size: 12px; color: #666; font-weight: 600;">Current Key:</p>
        <div style="
          font-family: monospace;
          font-size: 13px;
          color: #333;
          word-break: break-all;
          background: white;
          padding: 8px;
          border-radius: 3px;
          border: 1px solid #e0e0e0;
        ">${currentPassword}</div>
      </div>
    `
      : '';

    dialog.innerHTML = `
      <div style="
        background: white;
        border-radius: 8px;
        padding: 24px;
        max-width: 400px;
        width: 90%;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      ">
        <h3 style="margin: 0 0 16px 0;">🔐 Encryption Key</h3>
        ${currentKeySection}
        <p style="margin: 0 0 16px 0; color: #666;">
          Enter your encryption key. If you don't have one yet, create one now. 
          Share the same key with others to communicate.<br>
          <small style="color: #999;">Leave empty to clear the key and disable encryption.</small>
        </p>
        <input
          type="text"
          id="room-password-input"
          placeholder="Enter or create encryption key (or leave empty to clear)"
          style="
            width: 100%;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 14px;
            font-family: monospace;
            box-sizing: border-box;
          "
        />
        <div style="margin-top: 16px; display: flex; gap: 8px; justify-content: flex-end;">
          <button id="password-cancel-btn" style="
            padding: 8px 16px;
            border: 1px solid #ddd;
            background: white;
            border-radius: 4px;
            cursor: pointer;
          ">Cancel</button>
          <button id="password-submit-btn" style="
            padding: 8px 16px;
            border: none;
            background: #0066cc;
            color: white;
            border-radius: 4px;
            cursor: pointer;
          ">Save Key</button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    const input = dialog.querySelector('#room-password-input');
    const submitBtn = dialog.querySelector('#password-submit-btn');
    const cancelBtn = dialog.querySelector('#password-cancel-btn');

    input.focus();

    const cleanup = () => {
      document.body.removeChild(dialog);
      document.removeEventListener('keydown', handleEscape);
      encryptionState.dialogOpen = false; // Reset flag when dialog closes
    };

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        cleanup();
        resolve(null);
      }
    };

    // Add escape key listener
    document.addEventListener('keydown', handleEscape);

    submitBtn.onclick = () => {
      const password = input.value.trim();
      // Allow empty string (to clear key) or non-empty string (to set key)
      cleanup();
      resolve(password);
    };

    cancelBtn.onclick = () => {
      cleanup();
      resolve(null);
    };

    input.onkeypress = (e) => {
      if (e.key === 'Enter') {
        submitBtn.onclick();
      }
    };
  });
}

/**
 * Initialize room encryption (called when joining a room)
 * @param {string} roomId - Room ID or name
 * @returns {Promise<boolean>} Whether initialization succeeded
 */
async function initializeRoomEncryption(roomId) {
  // Check if Crypto API is supported first
  if (!cryptoSupported) {
    console.warn(
      '⚠️ Crypto API not supported, skipping encryption initialization',
    );
    encryptionState.roomKey = null;
    encryptionState.isEncrypted = false;
    encryptionState.initialized = true;
    return true;
  }

  // If already initialized in this session, reuse the current state
  if (encryptionState.initialized) {
    console.log('🔐 Encryption already initialized, reusing current state');
    return true;
  }

  console.log('🔐 Checking for saved encryption key...');

  // Check if we already have a password saved locally
  let key = await keyManager.getRoomKey(roomId);

  if (key) {
    console.log('✅ Using saved key from IndexedDB');
    encryptionState.roomKey = key;
    encryptionState.isEncrypted = true;
    encryptionState.initialized = true;
    return true;
  }

  // No saved key found
  console.log('ℹ️ No saved key found');

  // Prompt user to enter a key or continue without encryption
  const password = await showPasswordDialog({ name: roomId });

  if (password) {
    // User entered a key - save it locally
    console.log('🔑 Saving user-provided key');
    await keyManager.saveRoomPassword(roomId, password);
    encryptionState.roomKey = await keyManager.getRoomKey(roomId);
    encryptionState.isEncrypted = true;
    encryptionState.initialized = true;
    return true;
  } else {
    // User cancelled or skipped - enter without encryption
    console.log('⚠️ User entered without encryption key');
    addSystemMessage(
      '* You entered the room without an encryption key. You can set one in the room settings.',
    );
    encryptionState.roomKey = null;
    encryptionState.isEncrypted = false;
    encryptionState.initialized = true; // Mark as initialized even if user skipped
    return true;
  }
}

/**
 * Update UI based on encryption key availability
 */
function updateEncryptionUI() {
  const mainInputContainer = document.querySelector(
    '#main-chat-input-container',
  );
  const encryptionStatus = document.querySelector('#encryption-status');
  const encryptionStatusIcon = document.querySelector(
    '#encryption-status-icon',
  );
  const encryptionStatusText = document.querySelector(
    '#encryption-status-text',
  );

  if (!mainInputContainer) {
    // UI elements not ready yet
    return;
  }

  const hasValidKey = isRoomEncrypted && currentRoomKey;

  // Update desktop encryption status indicator
  if (encryptionStatus && encryptionStatusIcon && encryptionStatusText) {
    if (hasValidKey) {
      // Encrypted with valid key
      encryptionStatus.className = 'encrypted';
      encryptionStatusIcon.textContent = '🔒';
      encryptionStatusText.textContent = 'End-to-End Encrypted';
    } else {
      // Not encrypted or missing key
      encryptionStatus.className = 'not-encrypted';
      encryptionStatusIcon.textContent = '🔓';
      encryptionStatusText.textContent = 'Not Encrypted';
    }
  }

  // Update mobile encryption indicator
  MobileUI.updateMobileEncryptionIndicator(hasValidKey);

  if (isRoomEncrypted && !currentRoomKey) {
    // Also disable input placeholder to indicate it's not usable
    const chatInput = document.querySelector('#chat-input');
    if (chatInput && chatInput.textarea) {
      chatInput.textarea.placeholder =
        '🔒 Enter encryption key to send messages...';
    }
  } else {
    mainInputContainer.style.bottom = '0';

    // Restore normal placeholder
    const chatInput = document.querySelector('#chat-input');
    if (chatInput && chatInput.textarea) {
      chatInput.textarea.placeholder = 'Type a message...';
    }
  }
}

/**
 * Setup room encryption when creating/joining a room
 * E2EE: All encryption state is managed client-side in IndexedDB
 * @param {string} roomId - Room ID or name
 * @param {string} password - Encryption password
 * @returns {Promise<boolean>}
 */
async function setupRoomEncryption(roomId, password) {
  try {
    console.log('🔐 Setting up encryption locally...');

    // Save password to key manager (IndexedDB)
    await keyManager.saveRoomPassword(roomId, password);

    // Get the derived key
    encryptionState.roomKey = await keyManager.getRoomKey(roomId);
    encryptionState.isEncrypted = true;

    console.log('✅ Room encryption key saved locally');
    return true;
  } catch (error) {
    console.error('❌ Failed to setup room encryption:', error);
    alert('Failed to setup encryption: ' + error.message);
    return false;
  }
}

// User message API - handles sending messages through TinyBase
class UserMessageAPI {
  /**
   * Send a text message
   * @param {string} message - The message text to send
   * @param {object} replyTo - Optional reply information {messageId, username, preview}
   */
  async sendMessage(message, replyTo = null) {
    if (!message || message.length === 0) {
      return false;
    }

    // Wait for WebSocket session to be ready (server has confirmed username)
    if (isSessionReady && isSessionReady.promise) {
      await isSessionReady.promise;
    }

    // Wait for TinyBase store to be ready
    if (isStoreReady && isStoreReady.promise) {
      await isStoreReady.promise;
    }

    // Check if TinyBase store is ready
    if (!window.store || !window.messageList) {
      console.error('TinyBase store not ready');
      return false;
    }

    // Check if room is encrypted but user doesn't have the key
    if (isRoomEncrypted && !currentRoomKey) {
      alert(
        '⚠️ Cannot send message: You need the correct encryption key to send messages in this room.\n\nClick "🔑 Change Local Key" in the room info panel to enter the key.',
      );
      return false;
    }

    let messageToSend = message;

    // Encrypt message if room is encrypted AND crypto is supported
    if (isRoomEncrypted && currentRoomKey && cryptoSupported) {
      try {
        console.log('🔒 Encrypting message via worker pool...');

        // Export key for worker
        const keyData = Array.from(
          new Uint8Array(await crypto.subtle.exportKey('raw', currentRoomKey)),
        );

        // Encrypt via worker pool
        const encrypted = await cryptoPool.submitTask('encrypt', {
          plaintext: message,
          keyData: keyData,
        });

        messageToSend = CryptoUtils.formatEncryptedMessage(encrypted);
        console.log('✅ Message encrypted');
      } catch (error) {
        console.error('❌ Failed to encrypt message:', error);
        alert('Failed to encrypt message. Please check your connection.');
        return false;
      }
    } else if (isRoomEncrypted && currentRoomKey && !cryptoSupported) {
      // Crypto not supported but room is encrypted
      alert(
        '⚠️ Cannot send encrypted message: Your browser does not support encryption.\n\nPlease use a modern browser like Chrome, Firefox, or Safari.',
      );
      return false;
    }

    // Write message to TinyBase (will auto-sync via WsSynchronizer to other clients)
    try {
      const messageId = window.messageList.sendMessage(
        messageToSend, // Use encrypted message if encryption is enabled
        username,
        currentChannel,
        {
          encrypted: isRoomEncrypted,
          replyToId: replyTo?.messageId || null,
        },
      );
      console.log('📝 Message sent via TinyBase (will auto-sync):', messageId);
    } catch (error) {
      console.error('Failed to send message via TinyBase:', error);
      alert('Failed to send message. Please try again.');
      return false;
    }

    // Scroll to bottom whenever sending a message
    chatlog.scrollBy(0, 1e8);
    isAtBottom = true;

    return true;
  }
}

// Initialize user message API
const userApi = new UserMessageAPI();

// Thread functions
window.openThread = async function (messageId) {
  // Find the root message of the thread
  let rootMessageId = messageId;
  let currentMsg = messagesCache.get(messageId);

  if (!currentMsg) {
    console.error('Message not found in cache:', messageId);
    return;
  }

  // Traverse up to find the root (a message without replyTo)
  let visitedIds = new Set([messageId]); // Prevent infinite loops
  while (currentMsg && currentMsg.replyTo && currentMsg.replyTo.messageId) {
    const parentId = currentMsg.replyTo.messageId;

    // Check for circular reference
    if (visitedIds.has(parentId)) {
      console.warn('Circular reference detected in thread');
      break;
    }
    visitedIds.add(parentId);

    rootMessageId = parentId;
    const parentMsg = messagesCache.get(parentId);

    // If parent not in cache, stop here and use current rootMessageId
    if (!parentMsg) {
      console.warn(
        'Parent message not in cache:',
        parentId,
        '- using current as root',
      );
      break;
    }

    currentMsg = parentMsg;
  }

  currentThreadId = rootMessageId;

  // Update state - URL sync happens automatically via chatState
  if (chatState) {
    chatState.openThread(rootMessageId);
  }

  threadPanel.classList.add('visible');
  chatlog.classList.add('thread-open');

  // Also hide main chat input on mobile
  const mainInputContainer = document.getElementById(
    'main-chat-input-container',
  );
  if (mainInputContainer) {
    mainInputContainer.classList.add('thread-open');
  }

  // Handle mobile thread panel
  MobileUI.handleMobileThreadPanel(true);

  // Load and display root message
  const rootMessage = messagesCache.get(rootMessageId);
  if (rootMessage) {
    threadOriginalMessage.innerHTML = '';
    const msgElement = createMessageElement(rootMessage, false, true);
    threadOriginalMessage.appendChild(msgElement);
  } else {
    threadOriginalMessage.innerHTML =
      '<p style="color:#999;padding:16px;">Original message not available</p>';
  }

  // Load thread replies
  await loadThreadReplies(rootMessageId);

  // Focus thread input
  if (threadInputComponent) {
    threadInputComponent.focus();
  }
};

window.closeThread = function () {
  currentThreadId = null;

  // Update state - URL sync happens automatically via chatState
  if (chatState) {
    chatState.closeThread();
  }

  threadPanel.classList.remove('visible');
  chatlog.classList.remove('thread-open');

  // Show main chat input again
  const mainInputContainer = document.getElementById(
    'main-chat-input-container',
  );
  if (mainInputContainer) {
    mainInputContainer.classList.remove('thread-open');
  }

  // Handle mobile thread panel
  MobileUI.handleMobileThreadPanel(false);

  if (threadInputComponent) {
    threadInputComponent.clear();
  }
};

// Reply indicator functions
function setReplyTo(messageId, username, preview, rootMessageId) {
  currentReplyTo = { messageId, username, preview, rootMessageId };
  const indicator = document.getElementById('reply-indicator');
  const text = indicator.querySelector('.reply-indicator-text');
  text.innerHTML = `Replying to <strong>${username}</strong>: ${preview}`;
  indicator.style.display = 'flex';
  if (chatInputComponent) {
    chatInputComponent.focus();
  }
}

function clearReplyTo() {
  currentReplyTo = null;
  document.getElementById('reply-indicator').style.display = 'none';
}

// Count total replies for a message (including nested)
function countTotalReplies(messageId) {
  const visited = new Set();

  function countReplies(msgId) {
    if (visited.has(msgId)) return 0;
    visited.add(msgId);

    let count = 0;
    // Count direct replies
    for (const [cachedMsgId, cachedMsg] of messagesCache.entries()) {
      if (cachedMsg.replyTo && cachedMsg.replyTo.messageId === msgId) {
        count++;
        // Recursively count replies to this reply
        count += countReplies(cachedMsgId);
      }
    }
    return count;
  }

  return countReplies(messageId);
}

async function loadThreadReplies(messageId) {
  try {
    // All messages are already in messagesCache (synced from TinyBase)
    // Just need to find all replies to this message (including nested)
    const allReplies = [];
    const visited = new Set();

    // Recursive function to collect all replies
    function collectReplies(parentId) {
      if (visited.has(parentId)) return; // Prevent infinite loops
      visited.add(parentId);

      // Find direct replies to this parent
      for (const [msgId, msg] of messagesCache.entries()) {
        if (msg.replyTo && msg.replyTo.messageId === parentId) {
          allReplies.push(msg);
          // Recursively collect replies to this reply
          collectReplies(msgId);
        }
      }
    }

    // Start collecting from the root message
    collectReplies(messageId);

    // Update root message with total reply count
    const rootMessage = messagesCache.get(messageId);
    if (rootMessage) {
      rootMessage.threadInfo = {
        replyCount: allReplies.length,
        lastReplyTime:
          allReplies.length > 0
            ? Math.max(...allReplies.map((r) => r.timestamp))
            : null,
      };

      // Re-render the root message with updated count
      threadOriginalMessage.innerHTML = '';
      const msgElement = createMessageElement(rootMessage, false, true);
      threadOriginalMessage.appendChild(msgElement);
    }

    // Render all replies (sorted by timestamp)
    threadReplies.innerHTML = '';
    allReplies.sort((a, b) => a.timestamp - b.timestamp);
    allReplies.forEach((reply) => {
      const replyElement = createMessageElement(reply, true);
      threadReplies.appendChild(replyElement);
    });

    // Scroll to bottom
    threadReplies.scrollTop = threadReplies.scrollHeight;

    console.log(
      `✅ Loaded ${allReplies.length} thread replies from messagesCache`,
    );
  } catch (err) {
    console.error('Failed to load thread replies:', err);
    threadReplies.innerHTML =
      '<p style="color:#999;padding:16px;text-align:center;">Failed to load replies</p>';
  }
}

/**
 * Update thread info for a reply message
 * Called after rendering messages to update thread counts and thread panel
 * @param {Object} messageData - Message data with replyTo information
 */
function updateThreadInfo(messageData) {
  if (!messageData.replyTo) return;

  // Find the root message of this reply
  let rootId = messageData.replyTo.messageId;
  let parentMsg = messagesCache.get(rootId);
  while (parentMsg && parentMsg.replyTo) {
    rootId = parentMsg.replyTo.messageId;
    parentMsg = messagesCache.get(rootId);
  }

  // Update root message's reply count
  const rootMessage = messagesCache.get(rootId);
  if (rootMessage) {
    const totalReplies = countTotalReplies(rootId);
    rootMessage.threadInfo = rootMessage.threadInfo || {};
    rootMessage.threadInfo.replyCount = totalReplies;
    rootMessage.threadInfo.lastReplyTime = messageData.timestamp;

    // Update the message in main chat list (thread count badge)
    const mainChatMsg = document.querySelector(`[data-message-id="${rootId}"]`);
    if (mainChatMsg) {
      const chatMessage = mainChatMsg.querySelector('chat-message');
      if (chatMessage) {
        chatMessage.setAttribute('thread-count', String(totalReplies));
        chatMessage.render();
      }
    }
  }

  // If this reply belongs to the currently open thread, add it to thread panel
  if (currentThreadId === rootId) {
    // Check if this reply is already in the thread panel
    const existingReply = threadReplies.querySelector(
      `[data-message-id="${messageData.messageId}"]`,
    );
    if (!existingReply) {
      const threadReplyElement = createMessageElement(messageData, true);
      threadReplies.appendChild(threadReplyElement);
      threadReplies.scrollTop = threadReplies.scrollHeight;

      // Update thread count on the top message in thread panel
      if (rootMessage) {
        threadOriginalMessage.innerHTML = '';
        const msgElement = createMessageElement(rootMessage, false, true);
        threadOriginalMessage.appendChild(msgElement);
      }
    }
  }
}

function createMessageElement(
  data,
  isInThread = false,
  isThreadOriginal = false,
) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message-wrapper';
  wrapper.setAttribute('data-message-id', data.messageId);

  const p = document.createElement('p');
  p.style.margin = '0';

  const chatMessage = document.createElement('chat-message');
  chatMessage.setAttribute('username', data.name);
  chatMessage.setAttribute('message', data.message);
  chatMessage.setAttribute('timestamp', String(data.timestamp));
  chatMessage.setAttribute('message-id', data.messageId);
  chatMessage.setAttribute('is-in-thread', isInThread ? 'true' : 'false');
  chatMessage.setAttribute('channel', data.channel || 'general'); // Add channel attribute

  if (data.replyTo) {
    chatMessage.setAttribute('reply-to', JSON.stringify(data.replyTo));
  }

  if (data.threadInfo && data.threadInfo.replyCount > 0) {
    chatMessage.setAttribute(
      'thread-count',
      String(data.threadInfo.replyCount),
    );
  }

  // Add edited timestamp if message was edited
  if (data.editedAt) {
    chatMessage.setAttribute('edited-at', String(data.editedAt));
  }

  p.appendChild(chatMessage);
  wrapper.appendChild(p);

  // Store username and timestamp for grouping check
  wrapper.setAttribute('data-username', data.name);
  wrapper.setAttribute('data-timestamp', String(data.timestamp));

  // Add hover time (only show hours:minutes)
  const date = new Date(Number(data.timestamp));
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  wrapper.setAttribute('data-hover-time', `${hh}:${mm}`);

  // Add message actions
  const actions = document.createElement('div');
  actions.className = 'message-actions';

  // Create button container (removed timeSpan)
  const buttonsContainer = document.createElement('div');
  buttonsContainer.className = 'message-actions-buttons';

  // Add Copy button for all messages (first button)
  const copyBtn = document.createElement('button');
  copyBtn.className = 'message-action-btn';
  copyBtn.innerHTML = '<i class="ri-file-copy-line"></i> Copy';
  copyBtn.title = 'Copy message text';
  copyBtn.onclick = async (e) => {
    e.stopPropagation();
    try {
      // Don't copy FILE: messages, just show a notice
      if (data.message.startsWith('FILE:')) {
        copyBtn.innerHTML = '<i class="ri-check-line"></i> File';
        setTimeout(() => {
          copyBtn.innerHTML = '<i class="ri-file-copy-line"></i> Copy';
        }, 1000);
        return;
      }

      await navigator.clipboard.writeText(data.message);
      // Show feedback
      copyBtn.innerHTML = '<i class="ri-check-line"></i> Copied';
      setTimeout(() => {
        copyBtn.innerHTML = '<i class="ri-file-copy-line"></i> Copy';
      }, 1000);
    } catch (err) {
      console.error('Failed to copy message:', err);
      copyBtn.innerHTML = '<i class="ri-close-line"></i> Failed';
      setTimeout(() => {
        copyBtn.innerHTML = '<i class="ri-file-copy-line"></i> Copy';
      }, 1000);
    }
  };
  buttonsContainer.appendChild(copyBtn);

  if (isInThread || isThreadOriginal) {
    // In thread panel - show Locate button
    const locateBtn = document.createElement('button');
    locateBtn.className = 'message-action-btn';
    locateBtn.innerHTML = '📍 Locate';
    locateBtn.title = 'Locate in main chat';
    locateBtn.onclick = (e) => {
      e.stopPropagation();
      locateMessageInMainChat(data.messageId);
    };
    buttonsContainer.appendChild(locateBtn);
  } else {
    // In main chat - show Reply button
    const replyBtn = document.createElement('button');
    replyBtn.className = 'message-action-btn';
    replyBtn.innerHTML = '💬 Reply';
    replyBtn.onclick = (e) => {
      e.stopPropagation();
      // Set reply target instead of opening thread
      const preview = data.message.substring(0, 50);
      setReplyTo(data.messageId, data.name, preview, data.messageId);
    };
    buttonsContainer.appendChild(replyBtn);
  }

  // Add Delete button if user owns this message
  if (data.name === username) {
    // Add Edit button (only for non-file messages)
    if (!data.message.startsWith('FILE:')) {
      const editBtn = document.createElement('button');
      editBtn.className = 'message-action-btn';
      editBtn.innerHTML = '✏️ Edit';
      editBtn.title = 'Edit this message';
      editBtn.onclick = async (e) => {
        e.stopPropagation();
        showEditDialog(data);
      };
      buttonsContainer.appendChild(editBtn);
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'message-action-btn';
    deleteBtn.innerHTML = '🗑️ Delete';
    deleteBtn.style.color = '#dc3545';
    deleteBtn.title = 'Delete this message';
    deleteBtn.onclick = async (e) => {
      e.stopPropagation();
      if (confirm('Delete this message? This action cannot be undone.')) {
        try {
          // Delete from TinyBase (will auto-sync to other clients)
          if (window.messageList) {
            window.messageList.deleteMessage(data.messageId);
            console.log('✅ Message deleted via TinyBase');

            // Show re-edit banner with the deleted message content
            showReEditBanner(data.message);
          } else {
            throw new Error('Message list not initialized');
          }
        } catch (err) {
          console.error('Error deleting message:', err);
          alert(err.message || 'Failed to delete message');
        }
      }
    };
    buttonsContainer.appendChild(deleteBtn);
  }

  // Add Pin button (only in main chat, not in thread)
  if (!isInThread && !isThreadOriginal) {
    const pinBtn = document.createElement('button');
    pinBtn.className = 'message-action-btn';
    pinBtn.innerHTML = '<i class="ri-pushpin-line"></i> Pin';
    pinBtn.title = 'Pin this message';
    pinBtn.onclick = async (e) => {
      e.stopPropagation();
      // Use the global username variable (current logged-in user)
      pinMessage(roomname, currentChannel, data, username);
      pinBtn.innerHTML = '<i class="ri-pushpin-fill"></i> Pinned';
      setTimeout(() => {
        pinBtn.innerHTML = '<i class="ri-pushpin-line"></i> Pin';
      }, 2000);
    };
    buttonsContainer.appendChild(pinBtn);
  }

  actions.appendChild(buttonsContainer);

  // Wrap actions in a sticky container
  const actionsSticky = document.createElement('div');
  actionsSticky.className = 'message-actions-sticky';
  actionsSticky.appendChild(actions);

  // Insert at the beginning of wrapper
  wrapper.insertBefore(actionsSticky, wrapper.firstChild);

  return wrapper;
}

// Locate and highlight a message in the main chat area
function locateMessageInMainChat(messageId) {
  // Find the message in main chat
  const mainChatMsg = chatlog.querySelector(`[data-message-id="${messageId}"]`);

  if (mainChatMsg) {
    // Scroll to the message
    mainChatMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Highlight the message
    mainChatMsg.style.background = '#fff3cd';
    mainChatMsg.style.transition = 'background 0.3s ease';

    // Remove highlight after 2 seconds
    setTimeout(() => {
      mainChatMsg.style.background = '';
    }, 2000);
  } else {
    // Message not found in current view (might be filtered or not loaded)
    addSystemMessage('* Message not found in current chat view');
  }
}

// Load messages for a specific channel from TinyBase (no server request needed)
async function loadChannelMessages(channel) {
  console.log('📂 Switching to channel (TinyBase auto-synced):', channel);

  if (window.messageList && window.messageList.syncNow) {
    try {
      window.messageList.syncNow();
      console.log('✅ Channel view updated from TinyBase');
    } catch (error) {
      console.error('Failed to sync messages from TinyBase:', error);
    }
  }

  // Show welcome messages only on initial channel load
  // Check if this is the first time showing messages
  const isFirstLoad = !document.querySelector('.system-message');
  if (isFirstLoad) {
    addSystemMessage('* Hello ' + username + '!');
    addSystemMessage(
      '* This is a app built with Cloudflare Workers Durable Objects. The source code ' +
        'can be found at: https://github.com/bytemain/workers-chat',
    );
    addSystemMessage(
      '* WARNING: Participants in this chat are random people on the internet. ' +
        'Names are not authenticated; anyone can pretend to be anyone. Chat history is saved.',
    );
    if (roomname.length == 64) {
      addSystemMessage(
        '* This is a private room. You can invite someone to the room by sending them the URL.',
      );
    } else {
      addSystemMessage('* Welcome to ' + documentTitlePrefix + '. Say hi!');
    }
  }
}

async function loadChannels() {
  try {
    const data = await api.getChannels(roomname);
    const serverChannels = data.channels || [];

    // Merge server channels with temporary channels
    const channelMap = new Map();

    // Add all server channels
    serverChannels.forEach((ch) => {
      channelMap.set(ch.channel.toLowerCase(), ch);
    });

    // Add temporary channels that don't exist on server yet
    temporaryChannels.forEach((tempChannel) => {
      const key = tempChannel.toLowerCase();
      if (!channelMap.has(key)) {
        channelMap.set(key, {
          channel: tempChannel,
          count: 0,
          lastUsed: Date.now(),
        });
      }
    });

    // Ensure 'general' channel always exists (even if no messages yet)
    if (!channelMap.has('general')) {
      channelMap.set('general', {
        channel: 'general',
        count: 0,
        lastUsed: Date.now(),
      });
    }

    // Update mobile channel list if on mobile
    if (isMobile()) {
      updateMobileChannelList();
    }
  } catch (err) {
    console.error('Failed to load channels:', err);
  }
}

// Switch to a channel (sets it as current for sending messages)
async function switchToChannel(channel) {
  // Normalize DM channel names: if it's a DM, ensure username case matches
  let normalizedChannel = channel;
  const lowerChannel = channel.toLowerCase();

  if (lowerChannel.startsWith('dm-')) {
    const dmUsernameFromChannel = channel.substring(3); // Remove 'dm-' prefix

    // Check if this matches current user (case-insensitive)
    if (
      username &&
      dmUsernameFromChannel.toLowerCase() === username.toLowerCase()
    ) {
      // Normalize to use actual username case
      normalizedChannel = `dm-${username}`;
    }
    // Note: For DMs with other users, we'd need to look up their actual username
    // For now, this handles the self-DM case which is the reported bug
  }

  currentChannel = normalizedChannel;
  window.currentChannel = normalizedChannel; // Update global for pinned-messages

  // Update channelList current channel (Reef.js will auto re-render)
  if (window.channelList) {
    window.channelList.setCurrentChannel(normalizedChannel);
  }

  // Update state - URL sync happens automatically via chatState
  if (chatState) {
    chatState.switchChannel(normalizedChannel);
  }

  // Clear unread count for this channel
  clearChannelUnreadCount(normalizedChannel);

  // Update channel info bar
  const channelNameDisplay = document.getElementById('channel-name-display');
  const channelHash = document.querySelector('.channel-hash');
  const isDM = normalizedChannel.startsWith('dm-');

  if (channelNameDisplay) {
    // Check if it's a DM channel
    if (isDM) {
      const dmUsername = normalizedChannel.replace('dm-', '');
      channelNameDisplay.textContent =
        dmUsername === username ? `${dmUsername} (you)` : dmUsername;
    } else {
      channelNameDisplay.textContent = normalizedChannel;
    }
  }

  // Update icon for DM vs Channel
  if (channelHash) {
    if (isDM) {
      channelHash.innerHTML = '<i class="ri-user-3-line"></i>';
    } else {
      channelHash.textContent = '#';
    }
  }

  // Check if this channel exists in the current channel list
  const channelExists = window.channelList
    ? window.channelList.signal.items.some(
        (c) => c.channel.toLowerCase() === normalizedChannel.toLowerCase(),
      )
    : false;

  // If channel doesn't exist in the list, add it temporarily (frontend only)
  // It will be created on backend when first message is sent
  if (!channelExists && !normalizedChannel.startsWith('dm-')) {
    // Add to TinyBase (will trigger Reef.js re-render)
    if (window.channelList) {
      window.channelList.upsertChannel(normalizedChannel, 0);
    }

    // Fallback: Add to temporary channels set
    temporaryChannels.add(normalizedChannel);
  }

  // Update visual state for both channels and DMs
  document.querySelectorAll('.channel-item').forEach((item) => {
    const itemChannel = item.dataset.channel;
    const itemUser = item.dataset.user;

    // For DM items, compare usernames case-insensitively
    const isDMItem = itemUser !== undefined;
    let isMatch = false;

    if (isDMItem && isDM) {
      const dmUser = normalizedChannel.replace('dm-', '');
      isMatch = itemUser.toLowerCase() === dmUser.toLowerCase();
    } else if (itemChannel) {
      isMatch = itemChannel.toLowerCase() === normalizedChannel.toLowerCase();
    }

    if (isMatch) {
      item.classList.add('current');
    } else {
      item.classList.remove('current');
    }
  });

  // Load channel messages from backend instead of just filtering
  await loadChannelMessages(normalizedChannel);

  // Update mobile chat title if on mobile
  if (isMobile()) {
    const chatTitle = document.getElementById('mobile-chat-title');
    if (chatTitle) {
      const isDM = normalizedChannel.startsWith('dm-');
      if (isDM) {
        const dmUsername = normalizedChannel.substring(3);
        chatTitle.textContent =
          dmUsername === username ? `${username} (you)` : dmUsername;
      } else {
        chatTitle.textContent = '#' + normalizedChannel;
      }
    }
  }
}

// Expose switchToChannel to window for use in click handlers
window.switchToChannel = switchToChannel;

// Show context menu for right-click on channel
function showChannelContextMenu(event, channel) {
  // Remove any existing context menu
  const existing = document.querySelector('.channel-context-menu');
  if (existing) {
    existing.remove();
  }

  const menu = document.createElement('div');
  menu.className = 'channel-context-menu';
  menu.style.position = 'fixed';
  menu.style.left = event.clientX + 'px';
  menu.style.top = event.clientY + 'px';
  menu.style.background = 'white';
  menu.style.border = '1px solid #ccc';
  menu.style.borderRadius = '4px';
  menu.style.padding = '4px 0';
  menu.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
  menu.style.zIndex = '10000';

  const hideOption = document.createElement('div');
  hideOption.textContent = 'Remove from list';
  hideOption.style.padding = '8px 16px';
  hideOption.style.cursor = 'pointer';
  hideOption.style.fontSize = '14px';
  hideOption.addEventListener('mouseover', () => {
    hideOption.style.background = '#f0f0f0';
  });
  hideOption.addEventListener('mouseout', () => {
    hideOption.style.background = 'white';
  });
  hideOption.addEventListener('click', () => {
    hideChannel(channel);
    menu.remove();
  });

  menu.appendChild(hideOption);
  document.body.appendChild(menu);

  // Close menu on click outside
  setTimeout(() => {
    document.addEventListener('click', function closeMenu() {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    });
  }, 0);
}

// Hide channel (client-side only, stored in localStorage)
function hideChannel(channel) {
  const hiddenChannels = getHiddenChannels();
  if (!hiddenChannels.includes(channel)) {
    hiddenChannels.push(channel);
    saveHiddenChannels(hiddenChannels);
  }
}

// Get hidden channels from localStorage
function getHiddenChannels() {
  const key = `hiddenChannels:${roomname}`;
  const stored = localStorage.getItem(key);
  return stored ? JSON.parse(stored) : [];
}

// Save hidden channels to localStorage
function saveHiddenChannels(channels) {
  const key = `hiddenChannels:${roomname}`;
  localStorage.setItem(key, JSON.stringify(channels));
}

// Create a new channel (show prompt and switch to it)
function createNewChannel() {
  const channelName = prompt(
    'Enter channel name (2-32 characters, letters/numbers/underscore/hyphen only):',
  );

  if (!channelName) {
    return; // User cancelled
  }

  // Validate channel name
  const trimmed = channelName.trim().toLowerCase();

  if (trimmed.length < 2 || trimmed.length > 32) {
    alert('Channel name must be between 2 and 32 characters');
    return;
  }

  if (!/^[a-z0-9_-]+$/.test(trimmed)) {
    alert(
      'Channel name can only contain lowercase letters, numbers, underscores, and hyphens',
    );
    return;
  }

  // Check if channel already exists
  const exists = allChannels.some((ch) => ch.channel.toLowerCase() === trimmed);
  if (exists) {
    alert(`Channel #${trimmed} already exists`);
    // Switch to it anyway
    switchToChannel(trimmed);
    return;
  }

  // Create and switch to the new channel
  switchToChannel(trimmed);
}

// Initialize channel add button
function initChannelAddButton() {
  const addBtn = document.getElementById('channel-add-btn');
  if (addBtn) {
    addBtn.addEventListener('click', createNewChannel);
  }
}

// Initialize channel info bar buttons
function initChannelInfoBar() {
  // Toggle members panel
  const btnToggleMembers = document.getElementById('btn-toggle-members');
  if (btnToggleMembers) {
    btnToggleMembers.addEventListener('click', () => {
      const rightSidebar = document.getElementById('right-sidebar');
      if (rightSidebar) {
        rightSidebar.classList.toggle('visible');
        btnToggleMembers.classList.toggle('active');
      }
    });
  }

  // Show pinned messages
  const btnShowPins = document.getElementById('btn-show-pins');
  if (btnShowPins) {
    btnShowPins.addEventListener('click', () => {
      togglePinnedPanel(roomname, currentChannel);
    });
  }

  // Search messages (TODO: implement later)
  const btnSearchMessages = document.getElementById('btn-search-messages');
  if (btnSearchMessages) {
    btnSearchMessages.addEventListener('click', () => {
      console.log('Search messages - to be implemented');
      // TODO: Implement search modal
    });
  }

  // Room settings - placeholder for future features
  const btnRoomSettings = document.getElementById('btn-room-settings');
  if (btnRoomSettings) {
    btnRoomSettings.addEventListener('click', () => {
      console.log('Room settings - to be implemented');
      // TODO: Add more room settings in the future
    });
  }
}
// Initialize channel panel features
function initChannelPanel() {
  // Toggle section collapse
  document.querySelectorAll('.channel-section-header').forEach((header) => {
    header.addEventListener('click', () => {
      header.classList.toggle('collapsed');
    });
  });

  // Update room name in header (text only, arrow is in CSS)
  const roomNameLarge = document.getElementById('room-name-large');
  if (roomNameLarge && documentTitlePrefix) {
    // Remove any existing text nodes and set clean room name
    const textNode = roomNameLarge.childNodes[0];
    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
      textNode.textContent = documentTitlePrefix;
    } else {
      roomNameLarge.textContent = documentTitlePrefix;
    }
  }

  // Render DM list with self
  renderDMList();

  // DM add button (placeholder)
  const dmAddBtn = document.getElementById('dm-add-btn');
  if (dmAddBtn) {
    dmAddBtn.addEventListener('click', () => {
      console.log('Invite people - to be implemented');
      // TODO: Implement DM functionality
    });
  }
}

// Render DM list
function renderDMList() {
  const dmList = document.getElementById('dm-list');
  if (!dmList || !username) return;

  dmList.innerHTML = '';

  // Add self DM
  const selfDM = document.createElement('div');
  selfDM.className = 'channel-item dm-item';
  selfDM.dataset.user = username;

  // Avatar icon
  const icon = document.createElement('span');
  icon.className = 'channel-icon';
  icon.innerHTML = '<i class="ri-user-3-line"></i>';

  // User name
  const nameSpan = document.createElement('span');
  nameSpan.className = 'channel-name';
  nameSpan.textContent = `${username} (you)`;

  selfDM.appendChild(icon);
  selfDM.appendChild(nameSpan);

  selfDM.onclick = () => {
    // Switch to self DM channel
    const selfChannelName = `dm-${username}`;
    switchToChannel(selfChannelName);
  };

  dmList.appendChild(selfDM);
}

// Room history management
function getRoomHistory() {
  const history = localStorage.getItem('chatRoomHistory');
  return history ? JSON.parse(history) : [];
}

/**
 * Get room name from URL hash or pathname
 * Handles both formats: #roomname, /roomname, or roomname
 * @returns {string} Room name or empty string
 */
function getRoomNameFromURL() {
  // First try to get from hash
  const hash = document.location.hash;
  if (hash.length > 1) {
    // Remove leading # if present
    return hash.startsWith('#') ? hash.slice(1) : hash;
  }

  // If no hash, try pathname
  const pathname = document.location.pathname;
  if (pathname && pathname !== '/') {
    // Remove leading / if present
    return pathname.startsWith('/') ? pathname.slice(1) : pathname;
  }

  return '';
}

/**
 * Navigate to a specific room
 * Uses pathname instead of hash for cleaner URLs
 * @param {string} roomName - Room name to navigate to
 * @param {boolean} reload - Whether to reload the page (default: true)
 */
function navigateToRoom(roomName) {
  if (!roomName) {
    // Navigate to room selector
    window.location.pathname = '/';
    return;
  }

  // Update pathname
  window.location.pathname = '/' + roomName;
}

function addToRoomHistory(roomName) {
  let history = getRoomHistory();

  // Remove if already exists (to move to front)
  history = history.filter((item) => item.name !== roomName);

  // Add to front
  history.unshift({
    name: roomName,
    timestamp: Date.now(),
  });

  // Keep only last 10 rooms
  history = history.slice(0, 10);

  localStorage.setItem('chatRoomHistory', JSON.stringify(history));
}

function removeFromRoomHistory(roomName) {
  let history = getRoomHistory();
  history = history.filter((item) => item.name !== roomName);
  localStorage.setItem('chatRoomHistory', JSON.stringify(history));
  // Update left sidebar
  updateRoomListUI();
}

export function startNameChooser() {
  // Check if username is saved in localStorage
  let savedUsername = localStorage.getItem('chatUsername');

  // If no saved username, generate a random one (but don't save yet)
  if (!savedUsername) {
    savedUsername = generateRandomUsername();
    // Don't save here - wait until user enters a room
  }

  // Set username
  username = savedUsername;
  window.currentUsername = savedUsername; // Update global for pinned-messages

  // Update user info card in left sidebar
  updateUserInfoCard();

  // Go directly to room chooser
  startRoomChooser();
}

function startRoomChooser() {
  const roomFromURL = getRoomNameFromURL();
  if (roomFromURL) {
    roomname = roomFromURL;
    // Save username to localStorage when directly entering via URL
    localStorage.setItem('chatUsername', username);
    startChat();
    return;
  }

  // Set roomname to empty string instead of undefined
  roomname = '';

  // Update room name header to show we're in room selection mode
  const roomNameLarge = document.getElementById('room-name-large');
  if (roomNameLarge) {
    // Clear any existing content and set text
    roomNameLarge.textContent = 'Select a Room';
  }

  // Update user info card with current username
  updateUserInfoCard();

  // Show main UI with room selector in chatlog
  showRoomSelector();

  // Initialize left sidebar (room dropdown and user info)
  initializeLeftSidebar();

  // Set up room selector event handlers
  const selectorNameInput = document.getElementById('selector-name-input');
  const selectorRoomInput = document.getElementById('selector-room-input');
  const selectorJoinBtn = document.getElementById('selector-join-btn');
  const selectorPrivateBtn = document.getElementById('selector-private-btn');

  if (selectorNameInput) {
    selectorNameInput.value = username;
    selectorNameInput.addEventListener('input', (event) => {
      if (event.currentTarget.value.length > 32) {
        event.currentTarget.value = event.currentTarget.value.slice(0, 32);
      }
      username = event.currentTarget.value.trim();
      updateUserInfoCard();
    });
  }

  if (selectorRoomInput) {
    selectorRoomInput.addEventListener('input', (event) => {
      if (event.currentTarget.value.length > 32) {
        event.currentTarget.value = event.currentTarget.value.slice(0, 32);
      }
    });

    // Allow Enter key to join
    selectorRoomInput.addEventListener('keypress', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        selectorJoinBtn?.click();
      }
    });
  }

  if (selectorJoinBtn) {
    selectorJoinBtn.addEventListener('click', () => {
      username = selectorNameInput?.value.trim() || username;
      if (username.length === 0) {
        selectorNameInput?.focus();
        alert('Please enter your name');
        return;
      }
      localStorage.setItem('chatUsername', username);

      roomname = selectorRoomInput?.value.trim() || '';
      if (roomname.length > 0) {
        navigateToRoom(roomname);
      }
    });
  }

  if (selectorPrivateBtn) {
    selectorPrivateBtn.addEventListener('click', async () => {
      username = selectorNameInput?.value.trim() || username;
      if (username.length === 0) {
        selectorNameInput?.focus();
        alert('Please enter your name');
        return;
      }
      localStorage.setItem('chatUsername', username);

      selectorPrivateBtn.disabled = true;
      selectorPrivateBtn.textContent = 'Creating...';

      try {
        roomname = await api.createPrivateRoom();
        navigateToRoom(roomname);
      } catch (err) {
        alert('Something went wrong creating the private room');
        selectorPrivateBtn.disabled = false;
        selectorPrivateBtn.innerHTML = '🔒 Create a Private Room';
      }
    });
  }

  selectorRoomInput?.focus();
}

// Show room selector in chatlog
function showRoomSelector() {
  const roomSelector = document.getElementById('room-selector');
  const spacer = document.getElementById('spacer');
  const chatInput = document.getElementById('main-chat-input-container');

  if (roomSelector) {
    roomSelector.classList.add('visible');
  }
  if (spacer) {
    spacer.style.display = 'none';
  }
  if (chatInput) {
    chatInput.style.display = 'none';
  }
}

// Hide room selector when entering a room
function hideRoomSelector() {
  const roomSelector = document.getElementById('room-selector');
  const spacer = document.getElementById('spacer');
  const chatInput = document.getElementById('main-chat-input-container');

  if (roomSelector) {
    roomSelector.classList.remove('visible');
  }
  if (spacer) {
    spacer.style.display = 'block';
  }
  if (chatInput) {
    chatInput.style.display = 'block';
  }
}

// Room info state variables (declared at module level for WebSocket access)
let urlRoomHash = ''; // Store the room hash from URL
let roomNameLarge = document.querySelector('#room-name-large');

let documentTitlePrefix = '';
const { state: roomInfo, subscribe: subscribeRoomInfo } = createReactiveState({
  name: '',
  description: '',
  isLocalUpdate: false,
});

// Room Destruction Management (global scope for WebSocket access)
let destructionCountdownInterval = null;
let destructionEndTime = null;
let destructionCountdown = null;
let countdownTime = null;
let btnStartDestruction = null;
let btnCancelDestruction = null;
let destructionTimerSelect = null;

// Update countdown display
function updateCountdownDisplay() {
  if (!destructionEndTime || !countdownTime) return;

  const now = Date.now();
  const remaining = Math.max(0, destructionEndTime - now);

  if (remaining === 0) {
    // Destruction time reached
    if (destructionCountdown) {
      destructionCountdown.classList.remove('active');
    }
    addSystemMessage('* Room has been destroyed!');
    // The server will handle the actual destruction
    return;
  }

  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  countdownTime.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// Handle destruction updates from WebSocket (global function)
function handleDestructionUpdate(data) {
  if (data.destructionStarted) {
    destructionEndTime = data.destructionTime;
    if (destructionCountdown) {
      destructionCountdown.classList.add('active');
    }
    if (btnStartDestruction) {
      btnStartDestruction.style.display = 'none';
    }
    if (btnCancelDestruction) {
      btnCancelDestruction.style.display = 'block';
    }
    if (destructionTimerSelect) {
      destructionTimerSelect.disabled = true;
    }

    if (destructionCountdownInterval) {
      clearInterval(destructionCountdownInterval);
    }
    destructionCountdownInterval = setInterval(updateCountdownDisplay, 1000);
    updateCountdownDisplay();

    // Show system message about ongoing destruction
    const remaining = destructionEndTime - Date.now();
    const minutes = Math.ceil(remaining / 60000);
    addSystemMessage(
      `⚠️ Warning: This room will be destroyed in ${minutes} minute(s)!`,
    );
  } else if (data.destructionCancelled) {
    destructionEndTime = null;
    if (destructionCountdownInterval) {
      clearInterval(destructionCountdownInterval);
      destructionCountdownInterval = null;
    }
    if (destructionCountdown) {
      destructionCountdown.classList.remove('active');
    }
    if (btnStartDestruction) {
      btnStartDestruction.style.display = 'block';
    }
    if (btnCancelDestruction) {
      btnCancelDestruction.style.display = 'none';
    }
    if (destructionTimerSelect) {
      destructionTimerSelect.disabled = false;
    }
  } else if (data.roomDestroyed) {
    // Room has been destroyed
    if (destructionCountdownInterval) {
      clearInterval(destructionCountdownInterval);
      destructionCountdownInterval = null;
    }

    // Clear encryption key from IndexedDB
    if (roomname && keyManager) {
      keyManager
        .deleteRoomPassword(roomname)
        .then(() => {
          console.log('🗑️ Cleared encryption key for destroyed room');
        })
        .catch((err) => {
          console.error('❌ Failed to clear encryption key:', err);
        });
    }

    addSystemMessage('* This room has been destroyed. Redirecting...');
    setTimeout(() => {
      window.location.href = '/';
    }, 2000);
  }
}

async function startChat() {
  // Hide room selector and show chat interface
  hideRoomSelector();

  // Create new deferred promise for store ready
  isStoreReady = createPromiseResolvers();

  // Reset state for new room
  encryptionState.initialized = false;
  encryptionState.roomKey = null;
  encryptionState.isEncrypted = false;

  // Reset channel state
  allChannels = [];
  temporaryChannels.clear();
  currentChannel = 'general';

  // Normalize the room name a bit.
  roomname = roomname
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .replace(/_/g, '-')
    .toLowerCase();

  window.currentRoomName = roomname; // Update global for pinned-messages

  // Initialize chat state with URL sync
  initChatState();
  chatState.setRoom(roomname);

  if (roomname.length > 32 && !roomname.match(/^[0-9a-f]{64}$/)) {
    addSystemMessage('ERROR: Invalid room name.');
    return;
  }

  // No longer set hash, navigation is handled by pathname
  // document.location.hash = '#' + roomname;

  // Setup encryption with room name as default password if not already set
  // This handles all entry paths (form submit, buttons, URL hash)
  try {
    const existingPassword = await keyManager.getRoomPassword(roomname);
    if (!existingPassword) {
      // No password saved yet - use room name as default
      console.log('🔐 Setting up default encryption key (room name)');
      const defaultPassword = roomname;
      await setupRoomEncryption(roomname, defaultPassword);
    } else {
      console.log('🔐 Using existing saved encryption key');
    }
    await initializeRoomEncryption(roomname);
  } catch (error) {
    console.error('❌ Failed to setup encryption:', error);
    addSystemMessage('❌: Failed to setup encryption: ' + error.message);
  }

  // Initialize TinyBase store
  window.store = await createTinybaseStorage(roomname);
  console.log('✅ TinyBase store initialized');

  // Resolve store ready promise
  if (isStoreReady) {
    isStoreReady.resolve();
  }

  // Initialize message list component (TinyBase + Reef.js)
  let messageListComponent = null;
  try {
    messageListComponent = initMessageList(
      window.store,
      '#chatlog',
      () => currentChannel,
      createMessageElement, // 传入 createMessageElement 函数
      {
        // 加密上下文
        get currentRoomKey() {
          return currentRoomKey;
        },
        get isRoomEncrypted() {
          return isRoomEncrypted;
        },
      },
      messagesCache, // 传入全局消息缓存
      updateThreadInfo, // 传入线程信息更新函数
    );
    console.log('✅ Message list component initialized');

    // Expose to window for testing
    window.messageList = messageListComponent;

    // 监听 loading 状态变化，更新 channel info bar 的 loading 指示器
    const channelLoadingIndicator = document.getElementById(
      'channel-loading-indicator',
    );
    if (channelLoadingIndicator) {
      // 使用 Reef.js 的 signal 事件监听
      listenReefEvent('messagesSignal', () => {
        if (window.messageList.signal.loading) {
          channelLoadingIndicator.style.display = 'inline';
        } else {
          channelLoadingIndicator.style.display = 'none';
        }
      });
    }
  } catch (error) {
    console.error('❌ Failed to initialize message list:', error);
  }

  // Initialize channel list component (TinyBase + Reef.js)
  let channelListComponent = null;
  try {
    channelListComponent = initChannelList(
      window.store,
      '#channel-list',
      (channelName) => {
        console.log('📌 Channel clicked:', channelName);
        switchToChannel(channelName);
      },
    );
    console.log('✅ Channel list component initialized');

    // Expose to window for testing
    window.channelList = channelListComponent;
  } catch (error) {
    console.error('❌ Failed to initialize channel list:', error);
  }

  // Test: Print TinyBase store tables every 5 seconds
  setInterval(() => {
    if (window.store) {
      console.log('🔄 TinyBase store tables:', window.store.getTables());
    }
  }, 5000);

  // Save to room history
  addToRoomHistory(roomname);

  // Initialize reactive room info state
  // Use a temporary default name, will be replaced by server data
  const initialRoomName = roomname.length === 64 ? 'Private Room' : roomname;
  urlRoomHash = roomname.length === 64 ? '' : '#' + roomname;
  roomInfo.name = initialRoomName;

  // Set up reactive listener for document title updates
  subscribeRoomInfo((property, newValue, oldValue) => {
    if (property === 'name') {
      // Update room name display
      if (roomNameLarge) {
        roomNameLarge.textContent = newValue;
      }

      // Update document title (don't append hash if already included)
      let title = newValue;
      documentTitlePrefix = title;
      document.title = documentTitlePrefix + ' - Workers Chat';
    }
  });

  // Set initial display
  if (roomNameLarge) {
    roomNameLarge.textContent = roomInfo.name;
  }

  documentTitlePrefix = roomInfo.name;
  document.title = documentTitlePrefix + ' - Workers Chat';

  // Load room info from server
  async function loadRoomInfo() {
    try {
      const data = await api.getRoomInfo(roomname);
      // Only update if server has a custom name, otherwise keep the default
      if (data.name && data.name !== '') {
        roomInfo.name = data.name;
      }
      if (data.note) {
        roomInfo.description = data.note;
      }
    } catch (err) {
      console.error('Failed to load room info:', err);
    }
  }

  // Save room info to server
  async function saveRoomInfo() {
    try {
      await api.updateRoomInfo(roomname, {
        name: roomInfo.name,
        note: roomInfo.description,
      });
    } catch (err) {
      console.error('Failed to save room info:', err);
    }
  }

  loadRoomInfo();

  // Room name editing (room-name-large in left sidebar)
  if (roomNameLarge) {
    // Store original content when focusing
    let originalContent = '';

    roomNameLarge.addEventListener('focus', () => {
      originalContent = roomNameLarge.textContent;
      // Select all text when focused
      const range = document.createRange();
      range.selectNodeContents(roomNameLarge);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });

    roomNameLarge.addEventListener('blur', () => {
      const newName = roomNameLarge.textContent.trim();
      if (newName && newName !== roomInfo.name) {
        roomInfo.isLocalUpdate = true;
        roomInfo.name = newName;
        saveRoomInfo();
        // Reset flag after a short delay
        setTimeout(() => {
          roomInfo.isLocalUpdate = false;
        }, 500);
      } else if (!newName) {
        // Restore original content if empty
        roomNameLarge.textContent = originalContent || roomInfo.name;
      }
    });

    roomNameLarge.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        roomNameLarge.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        roomNameLarge.textContent = originalContent || roomInfo.name;
        roomNameLarge.blur();
      }
    });

    // Prevent line breaks in contenteditable
    roomNameLarge.addEventListener('paste', (event) => {
      event.preventDefault();
      const text = (event.clipboardData || window.clipboardData).getData(
        'text/plain',
      );
      // Remove line breaks and insert as plain text
      const cleanText = text.replace(/[\r\n]+/g, ' ');
      document.execCommand('insertText', false, cleanText);
    });
  }

  // Encryption Key Management
  const btnChangeEncryptionKey = document.querySelector(
    '#btn-change-encryption-key',
  );
  if (btnChangeEncryptionKey) {
    btnChangeEncryptionKey.addEventListener('click', async (e) => {
      e.preventDefault();

      // Get current password to display
      let currentPassword = null;
      try {
        currentPassword = await keyManager.getRoomPassword(roomname);
      } catch (error) {
        console.log('No current password found');
      }

      // Show dialog to enter new key with current key displayed
      const result = await showPasswordDialog(
        { name: roomname },
        currentPassword,
      );

      if (result === null) {
        // User cancelled (clicked cancel or ESC)
        return;
      }

      try {
        if (result === '') {
          // Empty string means clear the key
          await keyManager.deleteRoomPassword(roomname);
          encryptionState.roomKey = null;
          encryptionState.isEncrypted = false;

          alert(
            '✅ Encryption key cleared!\n\nThe room is now unencrypted for you.',
          );
        } else {
          // Save the new key locally (no server verification)
          await keyManager.saveRoomPassword(roomname, result);
          encryptionState.roomKey = await keyManager.getRoomKey(roomname);
          encryptionState.isEncrypted = true;

          alert(
            '✅ Encryption key saved locally!\n\nYou can now try to decrypt messages with this key.',
          );
        }

        // Reload the page to re-decrypt all messages with the new key
        window.location.reload();
      } catch (error) {
        console.error('Failed to update encryption key:', error);
        alert('Failed to update key: ' + error.message);
      }
    });
  }

  // Room Destruction Management - Initialize DOM elements
  destructionCountdown = document.querySelector('#destruction-countdown');
  countdownTime = document.querySelector('#countdown-time');
  btnStartDestruction = document.querySelector('#btn-start-destruction');
  btnCancelDestruction = document.querySelector('#btn-cancel-destruction');
  destructionTimerSelect = document.querySelector('#destruction-timer');

  // Start destruction countdown
  async function startDestruction() {
    // Prevent duplicate requests
    if (btnStartDestruction.disabled) {
      return;
    }

    const minutes = parseInt(destructionTimerSelect.value);

    const timeText = minutes === 0 ? 'immediately' : `in ${minutes} minutes`;
    if (
      !confirm(
        `Are you sure you want to destroy this room ${timeText}? All messages and files will be permanently deleted!`,
      )
    ) {
      return;
    }

    try {
      // Disable button during request
      btnStartDestruction.disabled = true;
      const originalText = btnStartDestruction.textContent;
      btnStartDestruction.textContent = '⏳ Starting...';

      const response = await api.destroyRoom(roomname, minutes);
      if (!response.ok) {
        throw new Error('Failed to start destruction');
      }

      const data = await response.json();
      destructionEndTime = data.destructionTime;

      if (minutes === 0) {
        // Immediate destruction - no countdown needed
        addSystemMessage(`* Room is being destroyed immediately...`);
        // The server will handle the destruction and notify us
      } else {
        // Show countdown
        destructionCountdown.classList.add('active');
        btnStartDestruction.style.display = 'none';
        btnCancelDestruction.style.display = 'block';
        destructionTimerSelect.disabled = true;

        // Start countdown interval
        if (destructionCountdownInterval) {
          clearInterval(destructionCountdownInterval);
        }
        destructionCountdownInterval = setInterval(
          updateCountdownDisplay,
          1000,
        );
        updateCountdownDisplay();

        addSystemMessage(`* Room destruction scheduled in ${minutes} minutes`);
      }
    } catch (err) {
      console.error('Failed to start destruction:', err);
      alert('Failed to start room destruction');

      // Restore button on error
      btnStartDestruction.disabled = false;
      btnStartDestruction.textContent = '🔥 Start Destruction';
    }
  }

  // Cancel destruction
  async function cancelDestruction() {
    // Prevent duplicate requests
    if (btnCancelDestruction.disabled) {
      return;
    }

    if (!confirm('Cancel room destruction?')) {
      return;
    }

    const originalText = btnCancelDestruction.textContent;
    try {
      // Disable button during request
      btnCancelDestruction.disabled = true;
      btnCancelDestruction.textContent = '⏳ Cancelling...';

      await api.cancelRoomDestruction(roomname);

      // Clear countdown
      destructionEndTime = null;
      if (destructionCountdownInterval) {
        clearInterval(destructionCountdownInterval);
        destructionCountdownInterval = null;
      }

      destructionCountdown.classList.remove('active');
      btnStartDestruction.style.display = 'block';
      btnCancelDestruction.style.display = 'none';
      destructionTimerSelect.disabled = false;

      // Re-enable start button
      btnStartDestruction.disabled = false;

      addSystemMessage('* Room destruction cancelled');
    } catch (err) {
      console.error('Failed to cancel destruction:', err);
      alert('Failed to cancel room destruction');

      // Restore button on error
      btnCancelDestruction.disabled = false;
      btnCancelDestruction.textContent = originalText;
    }
  }

  // Bind event listeners
  btnStartDestruction.addEventListener('click', startDestruction);
  btnCancelDestruction.addEventListener('click', cancelDestruction);

  // Prevent form submission (we handle it via custom events)
  chatroom.addEventListener('submit', (event) => {
    event.preventDefault();
  });

  // Initialize chat input component
  chatInputComponent = document.querySelector('#chat-input');
  threadInputComponent = document.querySelector('#thread-input');

  // Setup main chat input
  if (chatInputComponent) {
    // Setup character count display
    const charCountElement = document.getElementById('char-count');
    if (charCountElement && chatInputComponent.textarea) {
      const updateCharCount = () => {
        const length = chatInputComponent.textarea.value.length;

        // Only show character count when over 20000 characters
        if (length > 20000) {
          charCountElement.textContent = `${length} / ${MAX_MESSAGE_LENGTH}`;
          charCountElement.style.color =
            length > MAX_MESSAGE_LENGTH ? '#dc3545' : '#666';
          charCountElement.style.display = 'block';
        } else {
          charCountElement.style.display = 'none';
        }
      };

      // Update on input
      chatInputComponent.textarea.addEventListener('input', updateCharCount);

      // Initial update
      updateCharCount();
    }

    // Handle submit events from the component
    chatInputComponent.addEventListener('submit', async (event) => {
      const message = event.detail.message;

      if (message.length > 0) {
        // Check message length before sending
        if (message.length > MAX_MESSAGE_LENGTH) {
          alert(`Message is too long (max ${MAX_MESSAGE_LENGTH} characters)`);
          return;
        }

        // Send message using userApi (await the promise!)
        const sent = await userApi.sendMessage(message, currentReplyTo);

        if (sent && currentReplyTo) {
          // Clear reply state after sending
          clearReplyTo();
        }
      }
    });

    // Handle file uploads from the component
    chatInputComponent.onFileUpload = async (file) => {
      addSystemMessage('* Uploading file...');

      const success = await uploadFile(file, null, currentReplyTo);
      if (success && currentReplyTo) {
        // Clear reply state after successful upload
        clearReplyTo();
      }
    };

    // Handle navigation keys
    chatInputComponent.textarea.addEventListener('keydown', (event) => {
      if (event.keyCode == 38 && chatInputComponent.getValue() === '') {
        // up arrow (only if input is empty)
        chatlog.scrollBy(0, -50);
      } else if (event.keyCode == 40 && chatInputComponent.getValue() === '') {
        // down arrow (only if input is empty)
        chatlog.scrollBy(0, 50);
      } else if (event.keyCode == 33) {
        // page up
        chatlog.scrollBy(0, -chatlog.clientHeight + 50);
      } else if (event.keyCode == 34) {
        // page down
        chatlog.scrollBy(0, chatlog.clientHeight - 50);
      }
    });

    // Handle paste for file upload
    chatInputComponent.onPaste(async (event) => {
      const items = event.clipboardData?.items;
      if (!items) return;

      // Check for any file (images, documents, etc.)
      for (let item of items) {
        // Skip plain text items (let them paste normally)
        if (item.kind === 'file') {
          event.preventDefault();

          const file = item.getAsFile();
          if (!file) continue;

          // Determine file type for display
          const fileType = item.type.startsWith('image/') ? 'image' : 'file';

          // Show uploading message
          addSystemMessage(`* Uploading pasted ${fileType}...`);

          // Use file name if available, otherwise generate one with timestamp
          let fileName = file.name;
          if (!fileName || fileName === 'image.png' || fileName === 'blob') {
            // Generate filename with timestamp for unnamed files
            const timestamp = new Date()
              .toISOString()
              .replace(/[:.]/g, '-')
              .slice(0, -5);
            const extension = file.type.split('/')[1] || 'bin';
            fileName = `pasted-${timestamp}.${extension}`;
          }

          // Prepare replyTo info if replying to a message
          let replyToInfo = null;
          if (currentReplyTo) {
            replyToInfo = {
              messageId: currentReplyTo.messageId,
              username: currentReplyTo.username,
              preview: currentReplyTo.preview,
            };
          }

          const success = await uploadFile(file, fileName, replyToInfo);
          if (success && currentReplyTo) {
            // Clear reply state after successful upload
            clearReplyTo();
          }

          return; // Stop after processing the first file
        }
      }

      // If no file was found, allow default text paste behavior
    });

    chatInputComponent.focus();
  }

  chatlog.addEventListener('scroll', (event) => {
    // Allow 1px tolerance for floating point calculation errors
    isAtBottom =
      chatlog.scrollTop + chatlog.clientHeight >= chatlog.scrollHeight - 1;
  });

  document.body.addEventListener('click', (event) => {
    // If the user clicked somewhere in the window without selecting any text, focus the chat
    // input. But don't steal focus from textareas or input fields.
    const isTextInput =
      event.target.tagName === 'TEXTAREA' || event.target.tagName === 'INPUT';
    const isSelect = event.target.tagName === 'SELECT';
    if (window.getSelection().toString() == '' && !isTextInput && !isSelect) {
      if (chatInputComponent) {
        chatInputComponent.focus();
      }
    }
  });

  // Thread panel close
  threadClose.addEventListener('click', (event) => {
    event.stopPropagation();
    window.closeThread();
  });

  // Reply indicator close button
  replyIndicatorClose.addEventListener('click', () => {
    clearReplyTo();
  });

  // Setup thread input component
  if (threadInputComponent) {
    // Setup character count display for thread input
    const threadCharCountElement = document.getElementById('thread-char-count');
    if (threadCharCountElement && threadInputComponent.textarea) {
      const updateThreadCharCount = () => {
        const length = threadInputComponent.textarea.value.length;

        // Only show character count when over 20000 characters
        if (length > 20000) {
          threadCharCountElement.textContent = `${length} / ${MAX_MESSAGE_LENGTH}`;
          threadCharCountElement.style.color =
            length > MAX_MESSAGE_LENGTH ? '#dc3545' : '#666';
          threadCharCountElement.style.display = 'block';
        } else {
          threadCharCountElement.style.display = 'none';
        }
      };

      // Update on input
      threadInputComponent.textarea.addEventListener(
        'input',
        updateThreadCharCount,
      );

      // Initial update
      updateThreadCharCount();
    }

    threadInputComponent.addEventListener('submit', (event) => {
      sendThreadReply();
    });

    // Handle file uploads from the thread input component
    threadInputComponent.onFileUpload = async (file) => {
      if (!currentThreadId) return;

      addSystemMessage('* Uploading file...');

      const originalMessage = messagesCache.get(currentThreadId);
      if (!originalMessage) {
        addSystemMessage('* Error: Thread message not found');
        return;
      }

      // Prepare replyTo info for thread
      const replyToInfo = {
        messageId: currentThreadId,
        username: originalMessage.name,
        preview: originalMessage.message.substring(0, 100),
      };

      const success = await uploadFile(file, null, replyToInfo);
      if (!success) {
        // Error message already shown in uploadFile
      }
    };

    // Handle paste for file upload in thread input
    threadInputComponent.onPaste(async (event) => {
      if (!currentThreadId) return;

      const items = event.clipboardData?.items;
      if (!items) return;

      // Check for any file (images, documents, etc.)
      for (let item of items) {
        // Skip plain text items (let them paste normally)
        if (item.kind === 'file') {
          event.preventDefault();

          const file = item.getAsFile();
          if (!file) continue;

          // Determine file type for display
          const fileType = item.type.startsWith('image/') ? 'image' : 'file';

          // Show uploading message
          addSystemMessage(`* Uploading pasted ${fileType}...`);

          // Use file name if available, otherwise generate one with timestamp
          let fileName = file.name;
          if (!fileName || fileName === 'image.png' || fileName === 'blob') {
            // Generate filename with timestamp for unnamed files
            const timestamp = new Date()
              .toISOString()
              .replace(/[:.]/g, '-')
              .slice(0, -5);
            const extension = file.type.split('/')[1] || 'bin';
            fileName = `pasted-${timestamp}.${extension}`;
          }

          const originalMessage = messagesCache.get(currentThreadId);
          if (!originalMessage) {
            addSystemMessage('* Error: Thread message not found');
            return;
          }

          // Prepare replyTo info for thread
          const replyToInfo = {
            messageId: currentThreadId,
            username: originalMessage.name,
            preview: originalMessage.message.substring(0, 100),
          };

          await uploadFile(file, fileName, replyToInfo);

          return; // Stop after processing the first file
        }
      }

      // If no file was found, allow default text paste behavior
    });
  }

  async function sendThreadReply() {
    if (!threadInputComponent || !currentThreadId) return;

    const message = threadInputComponent.getValue().trim();
    if (!message) return;

    // Check message length before sending
    if (message.length > MAX_MESSAGE_LENGTH) {
      alert(`Message is too long (max ${MAX_MESSAGE_LENGTH} characters)`);
      return;
    }

    const originalMessage = messagesCache.get(currentThreadId);
    if (!originalMessage) return;

    // Prepare replyTo information
    const replyTo = {
      messageId: currentThreadId,
      username: originalMessage.name,
      preview: originalMessage.message.substring(0, 100),
    };

    // Send reply using userApi (await the promise!)
    const sent = await userApi.sendMessage(message, replyTo);

    if (sent) {
      threadInputComponent.clear();
    }
  }

  // Upload file function
  async function uploadFile(file, fileName = null, replyTo = null) {
    try {
      // Validate file size before anything else
      if (file.size > MAX_FILE_SIZE_BYTES) {
        const fileSizeFormatted = formatFileSize(file.size);
        const maxSizeFormatted = formatFileSize(MAX_FILE_SIZE_BYTES);
        const errorMsg = `File is too large (${fileSizeFormatted}). Maximum allowed size is ${maxSizeFormatted}.`;

        addSystemMessage(`* Upload failed: ${errorMsg}`);
        alert(errorMsg);
        return false;
      }

      let fileToUpload = file;
      let uploadFileName = fileName || file.name;

      // Encrypt file if room is encrypted AND crypto is supported
      if (isRoomEncrypted && currentRoomKey && cryptoSupported) {
        try {
          console.log('🔒 Encrypting file...');
          addSystemMessage(`* Encrypting file: ${uploadFileName}...`);

          const encryptedBlob = await FileCrypto.encryptFileV2(
            file,
            currentRoomKey,
            (progress, stage) => {
              console.log(`File encryption ${stage}: ${progress}%`);
            },
          );

          console.log('✅ File encrypted');
          fileToUpload = new File([encryptedBlob], uploadFileName + '.enc', {
            type: 'application/x-encrypted-v2',
          });
          addSystemMessage(`* File encrypted, uploading...`);
        } catch (error) {
          console.error('❌ Failed to encrypt file:', error);
          addSystemMessage('* Failed to encrypt file: ' + error.message);
          return false;
        }
      } else if (isRoomEncrypted && currentRoomKey && !cryptoSupported) {
        // Room is encrypted but crypto not supported
        addSystemMessage(
          '* Cannot upload encrypted file: Your browser does not support encryption. Please use a modern browser.',
        );
        return false;
      }

      // Create form data
      const formData = new FormData();
      formData.append('file', fileToUpload, fileToUpload.name);

      // Upload file
      const result = await api.uploadFile(roomname, formData);

      // Send file message using userApi
      // Include marker if file was encrypted
      let fileMessage;
      if (isRoomEncrypted) {
        // Mark as encrypted file with original name
        fileMessage = `FILE:${result.fileUrl}|${uploadFileName}|${file.type}|encrypted`;
      } else {
        fileMessage = `FILE:${result.fileUrl}|${result.fileName}|${result.fileType}`;
      }

      await userApi.sendMessage(fileMessage, replyTo);

      return true;
    } catch (err) {
      addSystemMessage('* Upload failed: ' + err.message);
      return false;
    }
  }

  // Setup mobile keyboard handler
  MobileUI.setupMobileKeyboardHandler(chatlog, () => isAtBottom);

  // Initialize left sidebar with room list and user info
  initializeLeftSidebar();

  // Initialize mobile navigation if on mobile
  initMobileNavigation();

  // Initialize pinned messages panel (Reef.js component)
  initPinnedMessages('body');

  // Clear unread count for current room
  clearUnreadCount(roomname);

  join();
}

let lastSeenTimestamp = 0;
let isReconnecting = false; // Track if this is a reconnection

// Helper function to create a deferred promise (polyfill for Promise.withResolvers)
function createPromiseResolvers() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let isSessionReady = null; // Promise that resolves when server confirms session is ready
let isStoreReady = null; // Promise that resolves when TinyBase store is initialized

function join() {
  // Create new deferred promise for session ready
  isSessionReady = createPromiseResolvers();

  let ws = new WebSocket(api.getWebSocketUrl(roomname));
  let rejoined = false;
  let startTime = Date.now();

  let rejoin = async () => {
    if (!rejoined) {
      rejoined = true;
      currentWebSocket = null;
      isReconnecting = true; // Mark as reconnecting

      // Clear the roster.
      while (roster.firstChild) {
        roster.removeChild(roster.firstChild);
      }

      // Don't try to reconnect too rapidly.
      let timeSinceLastJoin = Date.now() - startTime;
      if (timeSinceLastJoin < 3000) {
        // Less than 3 seconds elapsed since last join. Pause a bit.
        await new Promise((resolve) =>
          setTimeout(resolve, 3000 - timeSinceLastJoin),
        );
      }

      // OK, reconnect now!
      join();
    }
  };

  ws.addEventListener('open', async () => {
    currentWebSocket = ws;

    // Send user info message.
    ws.send(JSON.stringify({ name: username }));
  });

  ws.addEventListener('message', async (event) => {
    let data = JSON.parse(event.data);

    // NOTE: Regular chat messages are now handled by TinyBase WsSynchronizer
    // This WebSocket only handles system events

    if (data.error) {
      addSystemMessage('* Error: ' + data.error);
    } else if (data.roomInfoUpdate) {
      // Room info has been updated, refresh the display
      const info = data.roomInfoUpdate;
      let updated = false;

      if (info.name !== undefined && info.name !== roomInfo.name) {
        roomInfo.name = info.name;
        updated = true;
      }

      if (info.note !== undefined && info.note !== roomInfo.description) {
        roomInfo.description = info.note;
        updated = true;
      }

      // Show a notification that room info was updated (only if not from local edit)
      if (updated && !roomInfo.isLocalUpdate) {
        addSystemMessage('* Room info has been updated');
      }
    } else if (data.destructionUpdate) {
      // Handle room destruction updates
      handleDestructionUpdate(data.destructionUpdate);
    } else if (data.pinUpdate) {
      // Handle pin/unpin updates
      handlePinUpdate(data.pinUpdate);
    } else if (data.joined) {
      // Check if user is already in the roster (prevent duplicates)
      let alreadyInRoster = false;
      for (let child of roster.childNodes) {
        const existingUserName = child.querySelector
          ? child.querySelector('span')?.innerText
          : child.innerText;
        const normalizedExisting = existingUserName?.replace(' (me)', '');
        if (normalizedExisting === data.joined) {
          alreadyInRoster = true;
          break;
        }
      }

      // Only add if not already in roster
      if (!alreadyInRoster) {
        let userItem = document.createElement('div');
        userItem.className = 'user-item';

        let userName = document.createElement('span');
        userName.innerText =
          data.joined + (data.joined === username ? ' (me)' : '');
        userItem.appendChild(userName);

        // Add logout button only for current user
        if (data.joined === username) {
          let logoutBtn = document.createElement('button');
          logoutBtn.className = 'logout-btn';
          logoutBtn.innerText = '×';
          logoutBtn.title = 'Logout and change username';
          logoutBtn.onclick = (e) => {
            e.stopPropagation();
            // Clear saved username
            localStorage.removeItem('chatUsername');
            // Close WebSocket
            if (currentWebSocket) {
              currentWebSocket.close();
            }
            // Navigate to room selector
            navigateToRoom('');
          };
          userItem.appendChild(logoutBtn);
          userItem.classList.add('current-user');
        } else {
          userItem.classList.add('other-user');
          addSystemMessage(`* ${data.joined} has joined the room`);
        }

        roster.appendChild(userItem);
      }
    } else if (data.quit) {
      for (let child of roster.childNodes) {
        const userName = child.querySelector
          ? child.querySelector('span')?.innerText
          : child.innerText;
        if (userName == data.quit || userName == data.quit + ' (me)') {
          roster.removeChild(child);
          break;
        }
      }
      addSystemMessage(`* ${data.quit} has left the room`);
    } else if (data.ready) {
      // Session is ready
      isSessionReady.resolve();
      isInitialLoad = false;

      if (isReconnecting) {
        updateConnectionStatus('connected');
        isReconnecting = false;

        console.log('🔄 Reconnected - TinyBase will auto-sync messages');
      }
    }
  });

  ws.addEventListener('close', (event) => {
    console.log('WebSocket closed, reconnecting:', event.code, event.reason);
    if (
      event.code === 1000 &&
      event.reason === 'Reconnected from another session'
    ) {
      // This connection was replaced by a new one (e.g., user refreshed the page)
      // Don't reconnect since the new connection is already active
      addSystemMessage('* Connection replaced by a new session');
    } else if (event.code === 1009) {
      // Name too long or invalid - clear saved username
      localStorage.removeItem('chatUsername');
      addSystemMessage('* Connection closed: ' + event.reason);
    } else if (event.code !== 1000) {
      // Unexpected closure, try to reconnect
      updateConnectionStatus('reconnecting');
      rejoin();
    }
  });
  ws.addEventListener('error', (event) => {
    console.log('WebSocket error, reconnecting:', event);
    updateConnectionStatus('reconnecting');
    rejoin();
  });

  // Load channels from server into TinyBase
  if (window.channelList) {
    window.channelList.loadFromServer(api, roomname).then(async () => {
      // Initialize channel add button
      initChannelAddButton();
      // Initialize channel info bar
      initChannelInfoBar();
      // Initialize channel panel features
      initChannelPanel();

      // Check if there's a channel filter in the URL
      const urlParams = new URLSearchParams(window.location.search);
      const channelParam = urlParams.get('channel');
      if (channelParam) {
        // Switch to the channel from URL (will load messages)
        await switchToChannel(channelParam);
      } else {
        // No channel specified, load messages for default channel
        await loadChannelMessages(currentChannel);
      }

      // Check if there's a thread ID in the URL
      const threadParam = urlParams.get('thread');
      if (threadParam) {
        window.openThread(threadParam);
      }
    });
  }
}

function addSystemMessage(text) {
  let p = document.createElement('p');
  p.className = 'system-message';
  const sysMsg = document.createElement('system-message');
  sysMsg.setAttribute('message', text);
  p.appendChild(sysMsg);
  chatlog.appendChild(p);
  isAtBottom = true;
  chatlog.scrollBy(0, 1e8);
}

// Show re-edit button after deleting a message
function showReEditBanner(deletedMessage) {
  // Remove any existing re-edit element
  const existingElement = document.querySelector('.re-edit-container');
  if (existingElement) {
    existingElement.remove();
  }

  // Create container
  const container = document.createElement('div');
  container.className = 're-edit-container';
  container.style.cssText = `
    display: block;
    margin: 0px auto;
    padding: 8px 16px;
    text-align: center;
    font-size: 14px;
    color: #666;
  `;

  // Create text node
  const textNode = document.createTextNode('Message deleted, ');

  // Create clickable link
  const link = document.createElement('a');
  link.textContent = 'click to re-edit.';
  link.href = '#';
  link.style.cssText = `
    color: #007bff;
    text-decoration: none;
    cursor: pointer;
  `;

  // Click to restore message to input
  link.onclick = (e) => {
    e.preventDefault();

    // Put the deleted message back into the input
    if (chatInputComponent) {
      chatInputComponent.setValue(deletedMessage);
      chatInputComponent.focus();
    }

    // Remove the container
    container.remove();

    // Scroll to bottom to show input
    chatlog.scrollBy(0, 1e8);
  };

  // Hover effect
  link.onmouseenter = () => {
    link.style.color = '#0056b3';
    link.style.textDecoration = 'underline';
  };
  link.onmouseleave = () => {
    link.style.color = '#007bff';
    link.style.textDecoration = 'none';
  };

  // Assemble elements
  container.appendChild(textNode);
  container.appendChild(link);

  // Add to chatlog
  chatlog.appendChild(container);

  // Scroll to show the element
  isAtBottom = true;
  chatlog.scrollBy(0, 1e8);
}

// Show edit dialog for a message
function showEditDialog(messageData) {
  // Create overlay
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;

  // Create dialog
  const dialog = document.createElement('div');
  dialog.style.cssText = `
    background: white;
    border-radius: 8px;
    padding: 20px;
    width: 90%;
    max-width: 600px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  `;

  // Title
  const title = document.createElement('h3');
  title.textContent = 'Edit Message';
  title.style.marginTop = '0';
  dialog.appendChild(title);

  // Textarea
  const textarea = document.createElement('textarea');
  textarea.value = messageData.message;
  textarea.style.cssText = `
    width: 100%;
    min-height: 150px;
    padding: 10px;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-family: inherit;
    font-size: 14px;
    resize: vertical;
    box-sizing: border-box;
  `;
  dialog.appendChild(textarea);

  // Character count
  const charCount = document.createElement('div');
  charCount.style.cssText = `
    text-align: right;
    color: #666;
    font-size: 12px;
    margin-top: 4px;
  `;
  charCount.textContent = `${textarea.value.length} / ${MAX_MESSAGE_LENGTH}`;
  dialog.appendChild(charCount);

  textarea.addEventListener('input', () => {
    const len = textarea.value.length;
    charCount.textContent = `${len} / ${MAX_MESSAGE_LENGTH}`;
    charCount.style.color = len > MAX_MESSAGE_LENGTH ? '#dc3545' : '#666';
  });

  // Buttons container
  const buttons = document.createElement('div');
  buttons.style.cssText = `
    display: flex;
    gap: 10px;
    justify-content: flex-end;
    margin-top: 16px;
  `;

  // Cancel button
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = `
    padding: 8px 16px;
    border: 1px solid #ccc;
    background: white;
    border-radius: 4px;
    cursor: pointer;
  `;
  cancelBtn.onclick = () => overlay.remove();
  buttons.appendChild(cancelBtn);

  // Save button
  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.style.cssText = `
    padding: 8px 16px;
    border: none;
    background: #007bff;
    color: white;
    border-radius: 4px;
    cursor: pointer;
  `;
  saveBtn.onclick = async () => {
    const newMessage = textarea.value.trim();

    if (!newMessage) {
      alert('Message cannot be empty');
      return;
    }

    if (newMessage.length > MAX_MESSAGE_LENGTH) {
      alert(`Message is too long (max ${MAX_MESSAGE_LENGTH} characters)`);
      return;
    }

    if (newMessage === messageData.message) {
      // No changes
      overlay.remove();
      return;
    }

    try {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      // Edit message in TinyBase (will auto-sync to other clients)
      if (window.messageList) {
        window.messageList.editMessage(messageData.messageId, newMessage);
        console.log('✅ Message edited via TinyBase');
      } else {
        throw new Error('Message list not initialized');
      }

      overlay.remove();
    } catch (err) {
      console.error('Error editing message:', err);
      alert(err.message || 'Failed to edit message');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  };
  buttons.appendChild(saveBtn);

  dialog.appendChild(buttons);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  // Focus textarea and select all
  textarea.focus();
  textarea.select();

  // Close on overlay click
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      overlay.remove();
    }
  };

  // Close on Escape key
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

// NOTE: Browser back/forward navigation is now handled by chat-state.mjs
// The global popstate listener has been removed - URL state sync is automatic
// via chatState's syncUrlState integration

// ============================================
// Left Sidebar Room List Management
// ============================================

// Track unread counts for rooms
const unreadCounts = new Map();

// Get unread count for a room
function getUnreadCount(roomName) {
  return unreadCounts.get(roomName) || 0;
}

// Set unread count for a room
function setUnreadCount(roomName, count) {
  if (count <= 0) {
    unreadCounts.delete(roomName);
  } else {
    unreadCounts.set(roomName, count);
  }
  updateRoomListUI();
}

// Increment unread count for a room
function incrementUnreadCount(roomName) {
  const current = getUnreadCount(roomName);
  setUnreadCount(roomName, current + 1);
}

// Clear unread count for a room
function clearUnreadCount(roomName) {
  setUnreadCount(roomName, 0);
}

// Track unread counts for channels (within current room)
const channelUnreadCounts = new Map();

// Get unread count for a channel
function getChannelUnreadCount(channelName) {
  return channelUnreadCounts.get(channelName.toLowerCase()) || 0;
}

// Set unread count for a channel
function setChannelUnreadCount(channelName, count) {
  const key = channelName.toLowerCase();
  if (count <= 0) {
    channelUnreadCounts.delete(key);
  } else {
    channelUnreadCounts.set(key, count);
  }
  if (isMobile()) {
    updateMobileChannelList();
  }
}

// Increment unread count for a channel
function incrementChannelUnreadCount(channelName) {
  const current = getChannelUnreadCount(channelName);
  setChannelUnreadCount(channelName, current + 1);
}

// Clear unread count for a channel
function clearChannelUnreadCount(channelName) {
  setChannelUnreadCount(channelName, 0);
}

// Update room list UI - Now using isolated room-list component
function updateRoomListUI() {
  const roomDropdown = document.querySelector('#room-dropdown');
  if (!roomDropdown) return;

  // Prepare room data for the component
  const rooms = getRecentRooms();

  // Callbacks for room list component
  const callbacks = {
    onRoomClick: (roomName) => {
      if (roomName !== roomname) {
        navigateToRoom(roomName);
      }
      // Close dropdown
      roomDropdown.classList.remove('visible');
      document
        .querySelector('#room-info-header')
        ?.classList.remove('dropdown-open');
    },
    onCreateRoom: () => {
      // Navigate to room selector
      navigateToRoom('');
    },
    onRoomContextMenu: (e, roomName) => {
      showRoomContextMenu(e, roomName);
    },
  };

  // Use the isolated room-list component
  updateRoomList(roomDropdown, rooms, roomname, callbacks);
}

// Initialize room dropdown toggle
function initRoomDropdown() {
  const roomHeader = document.querySelector('#room-info-header');
  const roomDropdown = document.querySelector('#room-dropdown');
  const roomMenuBtn = document.querySelector('#room-menu-btn');

  if (!roomHeader || !roomDropdown) return;

  // Toggle dropdown on header click (but not on menu button)
  roomHeader.addEventListener('click', (e) => {
    // Don't toggle if clicking menu button
    if (e.target.closest('#room-menu-btn')) return;

    const isOpen = roomDropdown.classList.contains('visible');
    if (isOpen) {
      roomDropdown.classList.remove('visible');
      roomHeader.classList.remove('dropdown-open');
    } else {
      roomDropdown.classList.add('visible');
      roomHeader.classList.add('dropdown-open');
      updateRoomListUI(); // Update list when opening
    }
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!roomHeader.contains(e.target) && !roomDropdown.contains(e.target)) {
      roomDropdown.classList.remove('visible');
      roomHeader.classList.remove('dropdown-open');
    }
  });

  // Prevent menu button from toggling dropdown
  if (roomMenuBtn) {
    roomMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // TODO: Show room settings menu
    });
  }
} // Show room context menu
function showRoomContextMenu(event, targetRoomName) {
  const contextMenu = document.querySelector('#room-context-menu');
  if (!contextMenu) return;

  // Position the context menu
  contextMenu.style.left = event.pageX + 'px';
  contextMenu.style.top = event.pageY + 'px';
  contextMenu.classList.add('visible');

  // Setup leave room handler
  const leaveItem = document.querySelector('#context-menu-leave');
  if (leaveItem) {
    leaveItem.onclick = () => {
      removeFromRoomHistory(targetRoomName);
      contextMenu.classList.remove('visible');

      // If leaving current room, redirect to room chooser
      if (targetRoomName === roomname) {
        navigateToRoom('');
      }
    };
  }

  // Close context menu when clicking elsewhere
  const closeContextMenu = (e) => {
    if (!contextMenu.contains(e.target)) {
      contextMenu.classList.remove('visible');
      document.removeEventListener('click', closeContextMenu);
    }
  };

  // Delay to avoid immediate closing
  setTimeout(() => {
    document.addEventListener('click', closeContextMenu);
  }, 10);
}

// Update user info card
function updateUserInfoCard() {
  const userAvatar = document.querySelector('#user-avatar');
  const userNameDisplay = document.querySelector('#user-name-display');

  if (userAvatar && username) {
    userAvatar.setAttribute('name', username);
  }

  if (userNameDisplay && username) {
    userNameDisplay.textContent = username;
  }
}

// Initialize user action buttons
function initUserActionButtons() {
  const settingsBtn = document.querySelector('#user-settings-btn');
  const muteBtn = document.querySelector('#user-mute-btn');

  if (settingsBtn) {
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Open room settings modal
      const modal = document.querySelector('#room-settings-modal');
      if (modal) {
        modal.style.display = 'flex';
      }
    });
  }

  if (muteBtn) {
    let isMuted = false;
    muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      isMuted = !isMuted;
      muteBtn.textContent = isMuted ? '🔊' : '🔇';
      muteBtn.title = isMuted ? 'Unmute' : 'Mute';
      // TODO: Implement actual mute functionality
    });
  }
}

// Initialize room dropdown and user info when chat starts
function initializeLeftSidebar() {
  initRoomDropdown();
  updateRoomListUI();
  updateUserInfoCard();
  initUserActionButtons();
}

// Hide left sidebar when showing room form (no longer needed, but keep for compatibility)
function hideLeftSidebar() {
  // Left sidebar is hidden by CSS now
}

// Export functions for use in other parts of the code
window.navigateToRoom = navigateToRoom;
window.incrementUnreadCount = incrementUnreadCount;
window.clearUnreadCount = clearUnreadCount;
window.updateRoomListUI = updateRoomListUI;
window.updateUserInfoCard = updateUserInfoCard;
window.initializeLeftSidebar = initializeLeftSidebar;
window.hideLeftSidebar = hideLeftSidebar;

// ============================================
// Mobile Navigation System (Uses mobile.mjs module)
// ============================================

// Show mobile channel list page
function showMobileChannelList() {
  if (!isMobile()) return;

  // Clear channel via chatState - URL sync happens automatically
  if (chatState) {
    chatState.clearChannel();
  }

  // Reset to general channel (don't set to null)
  currentChannel = 'general';

  // Ensure channels are loaded and update channel list content
  if (window.channelList && window.channelList.signal.items.length === 0) {
    // If channels haven't been loaded yet, load them
    window.channelList.loadFromServer(api, roomname).then(() => {
      updateMobileChannelList();
    });
  } else {
    // Channels already loaded, just update the display
    updateMobileChannelList();
  }
}

// Show mobile chat page
function showMobileChatPage() {
  if (!isMobile()) return;

  MobileUI.showMobileChatPage();

  // Update chat title
  const chatTitle = document.getElementById('mobile-chat-title');
  if (chatTitle && currentChannel) {
    const isDM = currentChannel.startsWith('dm-');
    if (isDM) {
      const dmUsername = currentChannel.substring(3);
      chatTitle.textContent =
        dmUsername === username ? `${username} (you)` : dmUsername;
    } else {
      chatTitle.textContent = '#' + currentChannel;
    }
  }
}

// Update mobile channel list content
function updateMobileChannelList() {
  if (!isMobile()) return;

  const channelsContainer = document.getElementById(
    'mobile-channels-container',
  );
  const dmsContainer = document.getElementById('mobile-dms-container');

  if (!channelsContainer || !dmsContainer) return;

  // Get hidden channels
  const hiddenChannels = getHiddenChannels();

  // Clear containers
  channelsContainer.innerHTML = '';
  dmsContainer.innerHTML = '';

  // Render channels (filter out hidden and DM channels)
  const visibleChannels = allChannels.filter(
    (item) =>
      !hiddenChannels.includes(item.channel) &&
      !item.channel.toLowerCase().startsWith('dm-'),
  );

  // Sort channels: 'general' at the top, others by lastUsed descending
  const sortedChannels = [...visibleChannels].sort((a, b) => {
    const aIsGeneral = a.channel.toLowerCase() === 'general';
    const bIsGeneral = b.channel.toLowerCase() === 'general';

    // If one is 'general', it comes first
    if (aIsGeneral && !bIsGeneral) return -1;
    if (!aIsGeneral && bIsGeneral) return 1;

    // Both are general or neither is general, sort by lastUsed
    return (b.lastUsed || 0) - (a.lastUsed || 0);
  });

  if (sortedChannels.length === 0) {
    channelsContainer.innerHTML = `
      <div style="padding: var(--spacing); text-align: center; color: var(--text-muted);">
        No channels yet
      </div>
    `;
  } else {
    sortedChannels.forEach((item) => {
      const div = document.createElement('div');
      div.className = 'mobile-channel-item';

      const unreadCount = getChannelUnreadCount(item.channel);
      const unreadBadgeHTML =
        unreadCount > 0
          ? `<span class="channel-unread-badge">${unreadCount > 99 ? '99+' : unreadCount}</span>`
          : '';

      div.innerHTML = `
        <div class="mobile-channel-item-icon">
          <i class="ri-hashtag"></i>
        </div>
        <div class="mobile-channel-item-content">
          <div class="mobile-channel-item-name">${item.channel}${unreadBadgeHTML}</div>
          <div class="mobile-channel-item-count">${item.count || 0} messages</div>
        </div>
        <div class="mobile-channel-item-arrow">
          <i class="ri-arrow-right-s-line"></i>
        </div>
      `;

      div.onclick = () => {
        switchToChannel(item.channel);
        showMobileChatPage();
      };

      channelsContainer.appendChild(div);
    });
  }

  // Render DMs (self DM)
  if (username) {
    const selfDM = document.createElement('div');
    selfDM.className = 'mobile-channel-item';

    selfDM.innerHTML = `
      <div class="mobile-channel-item-icon">
        <i class="ri-user-3-line"></i>
      </div>
      <div class="mobile-channel-item-content">
        <div class="mobile-channel-item-name">${username} (you)</div>
        <div class="mobile-channel-item-count">Personal space</div>
      </div>
      <div class="mobile-channel-item-arrow">
        <i class="ri-arrow-right-s-line"></i>
      </div>
    `;

    selfDM.onclick = () => {
      const selfChannelName = `dm-${username}`;
      switchToChannel(selfChannelName);
      showMobileChatPage();
    };

    dmsContainer.appendChild(selfDM);
  }
}

// Initialize mobile navigation
function initMobileNavigation() {
  if (!isMobile()) return;

  // Back button from chat to channel list
  const chatBackBtn = document.getElementById('mobile-chat-back');
  if (chatBackBtn) {
    chatBackBtn.addEventListener('click', () => {
      showMobileChannelList();
    });
  }

  // Initialize mobile room selector
  initMobileRoomSelector();

  // Initialize mobile channel info component
  MobileUI.initMobileNavigation();

  // If we have a current channel, show chat page, otherwise show channel list
  if (currentChannel) {
    showMobileChatPage();
  } else {
    showMobileChannelList();
  }
}

// Initialize mobile room selector using room-list component
function initMobileRoomSelector() {
  const updateMobileRoomName = MobileUI.initMobileRoomSelector(
    roomname,
    populateMobileRoomDropdown,
  );

  if (updateMobileRoomName) {
    // Listen for room changes (popstate handles pathname changes)
    window.addEventListener('popstate', () => {
      updateMobileRoomName();
    });
  }
}

function getRecentRooms() {
  const history = getRoomHistory();

  // Prepare room data for room-list component
  const rooms = history.map((item) => {
    const isPrivate = item.name.length === 64;
    return {
      name: item.name,
      displayName: isPrivate ? 'Private Room' : item.name,
      isPrivate: isPrivate,
      unreadCount: getUnreadCount(item.name),
    };
  });

  return rooms;
}

// Populate mobile room dropdown using room-list component
function populateMobileRoomDropdown() {
  const mobileRoomDropdown = document.getElementById('mobile-room-dropdown');
  if (!mobileRoomDropdown) return;

  const rooms = getRecentRooms();
  // Callbacks for room-list component
  const callbacks = {
    onRoomClick: (roomName) => {
      navigateToRoom(roomName);
    },
    onCreateRoom: () => {
      navigateToRoom('');
    },
    onRoomContextMenu: (e, roomName) => {
      // Can add context menu functionality later if needed
      e.preventDefault();
    },
  };

  // Use updateRoomList from room-list.mjs
  updateRoomList(mobileRoomDropdown, rooms, roomname, callbacks);
}

// Export mobile functions
window.showMobileChannelList = showMobileChannelList;
window.showMobileChatPage = showMobileChatPage;
window.updateMobileChannelList = updateMobileChannelList;
window.initMobileNavigation = initMobileNavigation;
