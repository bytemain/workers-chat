import './web-components/index.mjs';

import { marked } from 'marked';
import { formatFileSize } from '../common/format-utils.js';
import { createReactiveState } from './react/state.mjs';
import { api } from './api.mjs';
import { generateRandomUsername } from './utils/random.mjs';
import { updateRoomList } from './room-list.mjs';
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
  initPinListener,
} from './pinned-messages.mjs';
import { chatState, initChatState } from './utils/chat-state.mjs';
import { userState, initUserState } from './utils/user-state.mjs';
import { createRxDBStorage } from './rxdb/index.mjs';
import { initMessageList } from './components/message-list.mjs';
import { initChannelList } from './components/channel-list.mjs';
import { initUserRoster } from './components/user-roster.mjs';
import { listenReefEvent } from './utils/reef-helpers.mjs';
import { createReadStatusStore } from './rxdb/read-status.mjs';
import { ReactionManager } from './reactions/manager.mjs';
import {
  initReactionEvents,
  renderReactions,
  showReactionPicker,
} from './reactions/ui.mjs';
import { REACTION_TYPES } from './reactions/config.mjs';

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

// Lazy loading image custom element
class LazyImg extends HTMLElement {
  constructor() {
    super();
    this.observer = null;
    this.loaded = false;
  }

  connectedCallback() {
    // Get attributes
    const src = this.getAttribute('data-src');
    const alt = this.getAttribute('alt') || '';
    const maxWidth = this.getAttribute('max-width') || '300px';
    const maxHeight = this.getAttribute('max-height') || '300px';
    const fileName = this.getAttribute('file-name') || 'image';

    // Store attributes
    this._realSrc = src;
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
      background: #f0f0f0;
      border: 2px dashed #ccc;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      margin-top: 5px;
      cursor: pointer;
    `;

    placeholder.innerHTML = `
      <div style="font-size: 48px; color: #999;">📷</div>
      <div style="margin-top: 8px; color: #999;">Loading...</div>
    `;

    this._placeholder = placeholder;
    this.appendChild(placeholder);

    this.setupLazyLoading();
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
    } catch (error) {
      console.error('❌ Failed to load image:', error);
      placeholder.innerHTML = `
        <div style="font-size: 32px; color: #cc0000;">❌</div>
        <div style="margin-top: 8px; color: #cc0000;">Failed to load</div>
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
        : () => {
            // Check scroll position directly
            const container =
              scrollContainer || document.querySelector('.chat-messages');
            if (!container) return false;
            return (
              container.scrollTop + container.clientHeight >=
              container.scrollHeight - 1
            );
          };

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
  }
}
customElements.define('lazy-img', LazyImg);

// File message custom element (for non-image files)
class FileMessage extends HTMLElement {
  constructor() {
    super();
    this.isDownloading = false;
    this.downloadAbortController = null;
  }

  connectedCallback() {
    this.render();
  }

  render() {
    const fileUrl = this.getAttribute('file-url');
    const fileName = this.getAttribute('file-name') || 'file';
    const fileSize = this.getAttribute('file-size');
    const uploadProgress = this.getAttribute('upload-progress');
    const uploadStatus = this.getAttribute('upload-status'); // 'uploading', 'success', 'error', or null/undefined

    // Clear existing content
    this.innerHTML = '';

    // Determine if this is an active upload (has explicit uploadStatus)
    const isUploading = uploadStatus === 'uploading';
    const isUploadError = uploadStatus === 'error';
    const isNormalFile = !uploadStatus || uploadStatus === 'success'; // Normal file or completed upload

    // Create file container
    const container = document.createElement('div');
    container.className = 'file-message-container';
    container.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      background: #f8f9fa;
      border: 1px solid #dee2e6;
      border-radius: 8px;
      max-width: 400px;
      margin: 4px 0;
    `;

    // File icon
    const icon = document.createElement('div');
    icon.className = 'file-icon';
    icon.style.cssText = `
      flex-shrink: 0;
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #e9ecef;
      border-radius: 6px;
      font-size: 24px;
    `;

    // Determine icon based on status
    if (isUploading) {
      icon.innerHTML = '<i class="ri-upload-2-line"></i>';
      icon.style.color = '#0d6efd';
    } else if (isUploadError) {
      icon.innerHTML = '<i class="ri-error-warning-line"></i>';
      icon.style.color = '#dc3545';
    } else {
      icon.innerHTML = '<i class="ri-file-line"></i>';
      icon.style.color = '#6c757d';
    }

    // File info section
    const infoSection = document.createElement('div');
    infoSection.style.cssText = `
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    `;

    // File name
    const nameElement = document.createElement('div');
    nameElement.style.cssText = `
      font-weight: 500;
      color: #212529;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    `;
    nameElement.textContent = fileName;

    // Status/size info
    const statusElement = document.createElement('div');
    statusElement.style.cssText = `
      font-size: 12px;
      color: #6c757d;
    `;

    if (isUploading) {
      statusElement.textContent = `Uploading... ${uploadProgress || 0}%`;
    } else if (isUploadError) {
      statusElement.textContent = 'Upload failed';
      statusElement.style.color = '#dc3545';
    } else if (fileSize !== null && fileSize !== undefined && fileSize !== '') {
      // Show file size for normal files (uploaded successfully or existing files)
      statusElement.textContent = formatFileSize(parseInt(fileSize));
    } else {
      // Fallback if no size info available
      statusElement.textContent = '';
    }

    infoSection.appendChild(nameElement);
    infoSection.appendChild(statusElement);

    // Progress bar (if uploading)
    if (isUploading) {
      const progressBar = document.createElement('div');
      progressBar.style.cssText = `
        width: 100%;
        height: 4px;
        background: #e9ecef;
        border-radius: 2px;
        overflow: hidden;
        margin-top: 4px;
      `;
      const progressFill = document.createElement('div');
      progressFill.style.cssText = `
        height: 100%;
        background: #0d6efd;
        width: ${uploadProgress || 0}%;
        transition: width 0.3s ease;
      `;
      progressBar.appendChild(progressFill);
      infoSection.appendChild(progressBar);
    }

    // Download progress bar
    this.progressBarContainer = document.createElement('div');
    this.progressBarContainer.style.cssText = `
      width: 100%;
      height: 4px;
      background: #e9ecef;
      border-radius: 2px;
      overflow: hidden;
      display: none;
    `;
    this.progressBarFill = document.createElement('div');
    this.progressBarFill.style.cssText = `
      height: 100%;
      background: #198754;
      width: 0%;
      transition: width 0.3s ease;
    `;
    this.progressBarContainer.appendChild(this.progressBarFill);
    // Action buttons
    const actionsContainer = document.createElement('div');
    actionsContainer.style.cssText = `
      display: flex;
      gap: 4px;
      flex-shrink: 0;
    `;

    if (isUploadError) {
      // Retry button
      const retryBtn = document.createElement('button');
      retryBtn.innerHTML = '<i class="ri-refresh-line"></i>';
      retryBtn.title = 'Retry upload';
      retryBtn.style.cssText = `
        padding: 6px 10px;
        background: #0d6efd;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
      `;
      retryBtn.onclick = () => {
        this.dispatchEvent(new CustomEvent('retry'));
      };
      actionsContainer.appendChild(retryBtn);
    } else if (isNormalFile) {
      // Download button
      const downloadBtn = document.createElement('button');
      downloadBtn.innerHTML = '<i class="ri-download-2-line"></i>';
      downloadBtn.title = 'Download file';
      downloadBtn.style.cssText = `
        padding: 6px 10px;
        background: #198754;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
      `;
      downloadBtn.onclick = () =>
        this.handleDownload(fileUrl, fileName, statusElement);
      actionsContainer.appendChild(downloadBtn);
    }

    container.appendChild(icon);
    container.appendChild(infoSection);
    container.appendChild(actionsContainer);
    this.appendChild(container);
  }

  async handleDownload(fileUrl, fileName, statusElement) {
    if (this.isDownloading) return;

    this.isDownloading = true;
    this.downloadAbortController = new AbortController();
    const originalStatus = statusElement.textContent;

    try {
      statusElement.textContent = 'Downloading...';
      this.progressBarContainer.style.display = 'block';

      const response = await fetch(fileUrl, {
        signal: this.downloadAbortController.signal,
      });

      if (!response.ok) throw new Error('Download failed');

      const contentLength = response.headers.get('content-length');
      const total = parseInt(contentLength, 10);
      let loaded = 0;

      const reader = response.body.getReader();
      const chunks = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        loaded += value.length;

        if (total && total > 0) {
          const progress = Math.min((loaded / total) * 100, 100);
          // Use requestAnimationFrame to ensure UI updates
          requestAnimationFrame(() => {
            this.progressBarFill.style.width = `${progress}%`;
            statusElement.textContent = `Downloading: ${Math.round(progress)}%`;
          });
        }
      }

      // Ensure 100% is shown before creating blob
      if (total && total > 0) {
        this.progressBarFill.style.width = '100%';
        statusElement.textContent = 'Downloading: 100%';
      }

      const blob = new Blob(chunks);
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(objectUrl);

      statusElement.textContent = originalStatus;
      this.progressBarContainer.style.display = 'none';
      this.progressBarFill.style.width = '0%';
    } catch (error) {
      if (error.name === 'AbortError') {
        statusElement.textContent = 'Download cancelled';
      } else {
        console.error('❌ Download failed:', error);
        statusElement.textContent = 'Download failed';
        statusElement.style.color = '#dc3545';
      }
      this.progressBarContainer.style.display = 'none';
      this.progressBarFill.style.width = '0%';
    } finally {
      this.isDownloading = false;
      this.downloadAbortController = null;
    }
  }
}
customElements.define('file-message', FileMessage);

// Define custom element for chat messages
class ChatMessage extends HTMLElement {
  static get observedAttributes() {
    return ['message', 'edited-at'];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue !== newValue && this.isConnected) {
      this.render();
    }
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
    const showUsername = this.getAttribute('show-username') === 'true';

    // Clear existing content
    this.innerHTML = '';

    // Check if previous message is from the same user
    const wrapper = this.closest('.message-wrapper');

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
      threadIndicator.innerHTML = `<i class="ri-chat-1-line"></i> ${threadCount} ${parseInt(threadCount) === 1 ? 'reply' : 'replies'}`;
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
    // Parse file message: support both JSON (new) and pipe-separated (legacy) formats
    let fileData;
    const content = message.substring(5); // Remove "FILE:" prefix

    if (content.startsWith('{')) {
      // New JSON format: FILE:{"url":"...","name":"...","type":"...","size":123,"encrypted":true}
      try {
        fileData = JSON.parse(content);
      } catch (e) {
        console.error('Failed to parse file message JSON:', e);
        fileData = {
          url: '',
          name: 'file',
          type: '',
          size: 0,
          encrypted: false,
        };
      }
    } else {
      // Legacy pipe-separated format: FILE:url|name|type|size|encrypted
      const parts = content.split('|');
      fileData = {
        url: parts[0],
        name: parts[1] || 'file',
        type: parts[2] || '',
        encrypted: parts[3] === 'encrypted',
      };
    }

    const {
      url: fileUrl,
      name: fileName,
      type: fileType,
      size: fileSize,
      uploadProgress,
      uploading,
      error,
    } = fileData;

    // Determine upload status from fileData
    const uploadStatus = uploading ? 'uploading' : error ? 'error' : null;

    // If it's an image, use lazy-img component
    if (fileType.startsWith('image/')) {
      const lazyImg = document.createElement('lazy-img');
      lazyImg.setAttribute('data-src', fileUrl);
      lazyImg.setAttribute('alt', fileName);
      lazyImg.setAttribute('file-name', fileName);
      lazyImg.setAttribute('max-width', '300px');
      lazyImg.setAttribute('max-height', '300px');

      container.appendChild(lazyImg);
    } else {
      // For other files, use file-message component
      const fileMessage = document.createElement('file-message');
      fileMessage.setAttribute('file-url', fileUrl);
      fileMessage.setAttribute('file-name', fileName);

      // Always set file-size if it's a valid number (including 0 for empty files)
      if (fileSize !== undefined && fileSize !== null && !isNaN(fileSize)) {
        fileMessage.setAttribute('file-size', String(fileSize));
      }

      // Only pass upload attributes if they exist (for temporary uploading messages)
      if (uploadProgress !== null && uploadProgress !== undefined) {
        fileMessage.setAttribute('upload-progress', uploadProgress);
      }
      if (uploadStatus) {
        fileMessage.setAttribute('upload-status', uploadStatus);
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

      // Post-process: add copy buttons to code blocks
      this.addCopyButtonsToCodeBlocks(markdownDiv);

      // Post-process: handle channel links (e.g., #channel-name)
      this.processChannelLinks(markdownDiv);

      // Post-process: add color preview to inline code blocks with hex colors
      this.processInlineCodeColors(markdownDiv);

      container.appendChild(markdownDiv);
    } catch (error) {
      console.error('Error rendering markdown:', error);
      // Fallback to plain text on error
      this.renderPlainTextMessage(text, container);
    }
  }

  // Add copy buttons to code blocks
  addCopyButtonsToCodeBlocks(container) {
    container.querySelectorAll('pre').forEach((preElement) => {
      // Skip if already wrapped
      if (preElement.parentElement.classList.contains('code-block-wrapper')) {
        return;
      }

      // Get the code content
      const codeElement = preElement.querySelector('code');
      const codeText = codeElement
        ? codeElement.textContent
        : preElement.textContent;

      // Create wrapper
      const wrapper = document.createElement('div');
      wrapper.className = 'code-block-wrapper';

      // Create copy button
      const copyBtn = document.createElement('button');
      copyBtn.className = 'code-copy-btn';
      copyBtn.innerHTML = '<i class="ri-clipboard-line"></i>';
      copyBtn.title = 'Copy code';
      copyBtn.setAttribute('aria-label', 'Copy code to clipboard');

      // Copy functionality
      copyBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        try {
          await navigator.clipboard.writeText(codeText);

          // Visual feedback
          copyBtn.innerHTML = '<i class="ri-check-line"></i>';
          copyBtn.classList.add('copied');
          copyBtn.title = 'Copied!';

          // Reset after 2 seconds
          setTimeout(() => {
            copyBtn.innerHTML = '<i class="ri-clipboard-line"></i>';
            copyBtn.classList.remove('copied');
            copyBtn.title = 'Copy code';
          }, 2000);
        } catch (err) {
          console.error('Failed to copy code:', err);

          // Fallback for older browsers
          const textArea = document.createElement('textarea');
          textArea.value = codeText;
          textArea.style.position = 'fixed';
          textArea.style.left = '-999999px';
          document.body.appendChild(textArea);
          textArea.select();

          try {
            document.execCommand('copy');
            copyBtn.innerHTML = '<i class="ri-check-line"></i>';
            copyBtn.classList.add('copied');
            setTimeout(() => {
              copyBtn.innerHTML = '<i class="ri-clipboard-line"></i>';
              copyBtn.classList.remove('copied');
            }, 2000);
          } catch (err2) {
            console.error('Fallback copy failed:', err2);
          }

          document.body.removeChild(textArea);
        }
      });

      // Wrap the pre element
      preElement.parentNode.insertBefore(wrapper, preElement);
      wrapper.appendChild(preElement);
      wrapper.appendChild(copyBtn);
    });
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

  // Process inline code blocks to add color preview for hex colors
  processInlineCodeColors(container) {
    // Find all inline code elements (not inside pre blocks)
    const codeElements = Array.from(container.querySelectorAll('code')).filter(
      (code) => code.parentElement.tagName !== 'PRE',
    );

    codeElements.forEach((codeElement) => {
      const text = codeElement.textContent.trim();

      // Match hex color patterns: #RGB, #RRGGBB, or #RRGGBBAA
      // Must be the entire content of the code block (or at least start with #)
      const hexColorRegex = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;
      const match = text.match(hexColorRegex);

      if (match) {
        // Valid hex color found
        const colorValue = text;

        // Create color preview circle
        const colorCircle = document.createElement('span');
        colorCircle.className = 'inline-code-color-preview';
        colorCircle.style.backgroundColor = colorValue;
        colorCircle.title = `Color: ${colorValue}`;

        // Append the circle to the code element
        codeElement.appendChild(colorCircle);
      }
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
let userRoster = null; // Will be initialized with Reef.js component

// Connection status element
let connectionStatus = document.querySelector('#connection-status');

// Thread panel elements
let threadPanel = document.querySelector('#thread-panel');
let threadClose = document.querySelector('#thread-close');
let threadOriginalMessage = document.querySelector('#thread-original-message');
let threadExpandToggle = document.querySelector('#thread-expand-toggle');
let threadReplies = document.querySelector('#thread-replies');
let threadInputComponent = null; // Will be initialized after DOM is ready

// Reply indicator elements
let replyIndicator = document.querySelector('#reply-indicator');
let replyIndicatorClose = replyIndicator.querySelector(
  '.reply-indicator-close',
);

let roomname;
let currentChannel = 'general'; // Current channel for sending messages (DEPRECATED: use chatState)

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
    return chatState?.value?.threadId;
  },
  set(v) {
    if (chatState) {
      v ? chatState.openThread(v) : chatState.closeThread();
    }
  },
  configurable: true,
});

// Export to window for use by other modules
window.currentRoomName = null;
window.currentUsername = null;

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

// User message API - handles sending messages through RxDB
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

    // Wait for RxDB store to be ready
    if (isStoreReady && isStoreReady.promise) {
      await isStoreReady.promise;
    }

    // Check if RxDB store is ready
    if (!window.store || !window.messageList) {
      console.error('RxDB store not ready');
      return false;
    }

    let messageToSend = message;

    // Write message to RxDB (will auto-sync via WebSocket replication to other clients)
    try {
      const messageId = window.messageList.sendMessage(
        messageToSend,
        userState.value.username,
        currentChannel,
        {
          replyToId: replyTo?.messageId || null,
        },
      );
      console.log('📝 Message sent via RxDB (will auto-sync):', messageId);
    } catch (error) {
      console.error('Failed to send message via RxDB:', error);
      alert('Failed to send message. Please try again.');
      return false;
    }

    // Scroll to bottom whenever sending a message
    if (window.messageList && window.messageList.scrollToBottom) {
      window.messageList.scrollToBottom();
    }

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

  // Update state - URL sync happens automatically via chatState
  if (chatState) {
    chatState.openThread(rootMessageId);
  }

  threadPanel.classList.add('visible');
  chatlog.classList.add('thread-open');

  // Also hide main chat input when thread is open
  const mainInputContainer = document.getElementById(
    'main-chat-input-container',
  );
  if (mainInputContainer) {
    mainInputContainer.classList.add('thread-open');
  }

  // Load and display root message using message-element
  const rootMessage = messagesCache.get(rootMessageId);
  if (rootMessage) {
    threadOriginalMessage.innerHTML = '';

    // Re-add the expand button
    if (threadExpandToggle) {
      threadOriginalMessage.appendChild(threadExpandToggle);
    }

    const msgElement = document.createElement('message-element');
    msgElement.setData({
      ...rootMessage,
      isInThread: false,
      isThreadOriginal: true,
      isFirstInGroup: true,
    });
    threadOriginalMessage.appendChild(msgElement);

    // Check if content overflows and show expand button if needed
    setTimeout(() => {
      const hasOverflow =
        threadOriginalMessage.scrollHeight > threadOriginalMessage.clientHeight;
      if (hasOverflow) {
        threadOriginalMessage.classList.add('has-overflow');
      } else {
        threadOriginalMessage.classList.remove('has-overflow');
      }
      // Reset expanded state
      threadOriginalMessage.classList.remove('expanded');
      if (threadExpandToggle) {
        const icon = threadExpandToggle.querySelector('i');
        const text = threadExpandToggle.querySelector('span');
        if (icon) icon.className = 'ri-arrow-down-s-line';
        if (text) text.textContent = 'Expand';
      }
    }, 100);
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
window.setReplyTo = setReplyTo;

function clearReplyTo() {
  currentReplyTo = null;
  document.getElementById('reply-indicator').style.display = 'none';
}
window.clearReplyTo = clearReplyTo;

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
    // ✅ Use index for efficient thread reply lookup - O(log n)
    // getSliceRowIds returns all messages where replyToId = messageId
    const replyIds = window.indexes
      ? window.indexes.getSliceRowIds('repliesByParent', messageId)
      : [];

    console.log(
      `📇 Index query: found ${replyIds.length} direct replies to ${messageId}`,
    );

    // Get all reply messages (already sorted by timestamp via index)
    const allReplies = replyIds
      .map((replyId) => messagesCache.get(replyId))
      .filter((msg) => msg); // Filter out undefined entries

    // Collect nested replies recursively (for multi-level threads)
    const visited = new Set([messageId]);
    function collectNestedReplies(parentId) {
      if (visited.has(parentId)) return []; // Prevent infinite loops
      visited.add(parentId);

      const nestedIds = window.indexes
        ? window.indexes.getSliceRowIds('repliesByParent', parentId)
        : [];

      const nested = [];
      nestedIds.forEach((nestedId) => {
        const msg = messagesCache.get(nestedId);
        if (msg && !visited.has(nestedId)) {
          nested.push(msg);
          nested.push(...collectNestedReplies(nestedId)); // Recursively collect deeper replies
        }
      });
      return nested;
    }

    // Add nested replies
    allReplies.forEach((reply) => {
      const nestedReplies = collectNestedReplies(reply.messageId);
      allReplies.push(...nestedReplies);
    });

    // Sort by timestamp (in case of nested replies)
    allReplies.sort((a, b) => a.timestamp - b.timestamp);

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

      // Re-render the root message with updated count using message-element
      threadOriginalMessage.innerHTML = '';
      const msgElement = document.createElement('message-element');
      msgElement.setData({
        ...rootMessage,
        isInThread: false,
        isThreadOriginal: true,
        isFirstInGroup: true,
      });
      threadOriginalMessage.appendChild(msgElement);
    }

    // Render all replies using message-element (sorted by timestamp)
    threadReplies.innerHTML = '';
    allReplies.sort((a, b) => a.timestamp - b.timestamp);

    // 计算每条消息是否是分组中的第一条
    allReplies.forEach((reply, index) => {
      let isFirstInGroup = true;
      if (index > 0) {
        const prevReply = allReplies[index - 1];
        if (prevReply.name === reply.name) {
          const timeDiff = reply.timestamp - prevReply.timestamp;
          if (timeDiff < 5 * 60 * 1000) {
            isFirstInGroup = false;
          }
        }
      }

      const replyElement = document.createElement('message-element');
      replyElement.setData({
        ...reply,
        isInThread: true,
        isThreadOriginal: false,
        isFirstInGroup,
      });
      threadReplies.appendChild(replyElement);
    });

    // Scroll to bottom
    threadReplies.scrollTop = threadReplies.scrollHeight;

    console.log(
      `✅ Loaded ${allReplies.length} thread replies using message-element`,
    );
  } catch (err) {
    console.error('Failed to load thread replies:', err);
    threadReplies.innerHTML =
      '<p style="color:#999;padding:16px;text-align:center;">Failed to load replies</p>';
  }
}

// Show message actions menu (More button dropdown)
function showMessageActionsMenu(
  triggerBtn,
  data,
  isInThread,
  isThreadOriginal,
) {
  // Remove existing menu
  document
    .querySelectorAll('.message-actions-menu')
    .forEach((el) => el.remove());

  const menu = document.createElement('div');
  menu.className = 'message-actions-menu';
  menu.style.position = 'absolute';
  menu.style.zIndex = '1000';
  menu.style.background = 'var(--background)';
  menu.style.border = '1px solid var(--border)';
  menu.style.borderRadius = '6px';
  menu.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
  menu.style.minWidth = '160px';
  menu.style.padding = '4px 0';

  const actions = [];

  // Copy action
  actions.push({
    icon: 'ri-file-copy-line',
    label: 'Copy',
    disabled: data.message.startsWith('FILE:'),
    onClick: async () => {
      if (!data.message.startsWith('FILE:')) {
        await navigator.clipboard.writeText(data.message);
      }
    },
  });

  // Pin action (only in main chat)
  if (!isInThread && !isThreadOriginal) {
    actions.push({
      icon: 'ri-pushpin-line',
      label: 'Pin',
      onClick: async () => {
        await pinMessage(data.messageId);
      },
    });
  }

  // Edit action (only for own messages, non-file)
  if (
    data.name === userState.value.username &&
    !data.message.startsWith('FILE:')
  ) {
    actions.push({
      icon: 'ri-edit-line',
      label: 'Edit',
      onClick: () => {
        showEditDialog(data);
      },
    });
  }

  // Delete action (only for own messages)
  if (data.name === userState.value.username) {
    actions.push({
      icon: 'ri-delete-bin-line',
      label: 'Delete',
      danger: true,
      onClick: async () => {
        if (confirm('Delete this message? This action cannot be undone.')) {
          if (window.messageList) {
            window.messageList.deleteMessage(data.messageId);
            showReEditBanner(data.message);
          }
        }
      },
    });
  }

  // Render menu items
  actions.forEach((action) => {
    const item = document.createElement('button');
    item.style.display = 'flex';
    item.style.alignItems = 'center';
    item.style.gap = '8px';
    item.style.width = '100%';
    item.style.padding = '8px 12px';
    item.style.background = 'transparent';
    item.style.border = 'none';
    item.style.cursor = action.disabled ? 'not-allowed' : 'pointer';
    item.style.textAlign = 'left';
    item.style.fontSize = '14px';
    item.style.color = action.danger
      ? '#dc3545'
      : action.disabled
        ? 'var(--text-muted)'
        : 'var(--text-main)';
    item.style.opacity = action.disabled ? '0.5' : '1';

    item.innerHTML = `<i class="${action.icon}"></i> ${action.label}`;

    if (!action.disabled) {
      item.onmouseenter = () => {
        item.style.background = 'var(--background-alt)';
      };
      item.onmouseleave = () => {
        item.style.background = 'transparent';
      };
      item.onclick = (e) => {
        e.stopPropagation();
        action.onClick();
        menu.remove();
      };
    }

    menu.appendChild(item);
  });

  // Position menu
  document.body.appendChild(menu);
  const rect = triggerBtn.getBoundingClientRect();
  menu.style.left = `${rect.right + 4}px`;
  menu.style.top = `${rect.top}px`;

  // Adjust if off-screen
  const menuRect = menu.getBoundingClientRect();
  if (menuRect.right > window.innerWidth) {
    menu.style.left = `${rect.left - menuRect.width - 4}px`;
  }
  if (menuRect.bottom > window.innerHeight) {
    menu.style.top = `${window.innerHeight - menuRect.height - 8}px`;
  }

  // Close on click outside
  setTimeout(() => {
    function closeMenu(e) {
      if (!menu.contains(e.target) && e.target !== triggerBtn) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    }
    document.addEventListener('click', closeMenu);
  }, 0);
}
window.showMessageActionsMenu = showMessageActionsMenu;

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
window.locateMessageInMainChat = locateMessageInMainChat;

// Load messages for a specific channel from RxDB (no server request needed)
async function loadChannelMessages(channel) {
  console.log('📂 Switching to channel (RxDB auto-synced):', channel);

  if (window.messageList && window.messageList.syncNow) {
    try {
      window.messageList.syncNow();
      console.log('✅ Channel view updated from RxDB');
    } catch (error) {
      console.error('Failed to sync messages from RxDB:', error);
    }
  }
}

// Switch to a channel (sets it as current for sending messages)
async function switchToChannel(channel) {
  const normalizedChannel = channel;

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
  if (channelList) {
    channelList.clearChannelUnreadCount(normalizedChannel);
  }

  // Update channel info bar
  const channelNameDisplay = document.getElementById('channel-name-display');
  const channelHash = document.querySelector('.channel-hash');

  if (channelNameDisplay) {
    channelNameDisplay.textContent = normalizedChannel;
  }

  if (channelHash) {
    channelHash.textContent = '#';
  }

  // Check if this channel exists in the current channel list
  const channelExists = window.channelList
    ? window.channelList.signal.items.some(
        (c) => c.channel.toLowerCase() === normalizedChannel.toLowerCase(),
      )
    : false;

  // If channel doesn't exist in the list, add it temporarily (frontend only)
  // It will be created on backend when first message is sent
  if (!channelExists) {
    // Add to RxDB (will trigger Reef.js re-render)
    if (window.channelList) {
      window.channelList.upsertChannel(normalizedChannel, 0);
    }
  }

  // Update visual state for channels
  document.querySelectorAll('.channel-item').forEach((item) => {
    const itemChannel = item.dataset.channel;
    let isMatch = false;

    if (itemChannel) {
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
    'Enter channel name (1-32 characters, letters/numbers/underscore/hyphen only):',
  );

  if (!channelName) {
    return; // User cancelled
  }

  // Validate channel name
  const trimmed = channelName.trim().toLowerCase();

  if (trimmed.length < 1 || trimmed.length > 32) {
    alert('Channel name must be between 1 and 32 characters');
    return;
  }

  if (!/^[a-z0-9_-]+$/.test(trimmed)) {
    alert(
      'Channel name can only contain lowercase letters, numbers, underscores, and hyphens',
    );
    return;
  }

  // Check if channel already exists in RxDB
  const channelExists =
    window.store && window.store.hasRow('channels', trimmed);
  if (channelExists) {
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

// Track if channel info bar has been initialized (prevent duplicate listeners)
let channelInfoBarInitialized = false;

// Initialize channel info bar buttons
function initChannelInfoBar() {
  // Prevent duplicate event listeners
  if (channelInfoBarInitialized) return;
  channelInfoBarInitialized = true;

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

  // Search messages
  const btnSearchMessages = document.getElementById('btn-search-messages');
  if (btnSearchMessages) {
    btnSearchMessages.addEventListener('click', () => {
      showSearchModal();
    });
  }

  // Search modal and functionality
  function showSearchModal() {
    // Check if modal already exists
    const existingModal = document.querySelector('.search-modal-overlay');
    if (existingModal) {
      console.log('Search modal already open');
      return;
    }

    const modal = document.createElement('div');
    modal.className = 'search-modal-overlay';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    `;

    modal.innerHTML = `
      <div style="
        background: white;
        border-radius: 8px;
        padding: 24px;
        max-width: 600px;
        width: 90%;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      ">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <h3 style="margin: 0;">🔍 Search Messages</h3>
          <button id="search-modal-close" style="
            border: none;
            background: none;
            font-size: 24px;
            cursor: pointer;
            color: #666;
          ">×</button>
        </div>

        <input
          type="text"
          id="search-input"
          placeholder="Search... (Try: from:username, in:channel, has:link)"
          style="
            width: 100%;
            padding: 12px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 14px;
            box-sizing: border-box;
            margin-bottom: 16px;
          "
        />

        <div style="
          background: #f5f5f5;
          padding: 12px;
          border-radius: 4px;
          margin-bottom: 16px;
          font-size: 12px;
          color: #666;
        ">
          <strong>Search Filters:</strong><br>
          <code>from:username</code> - Filter by user<br>
          <code>in:channel</code> - Filter by channel<br>
          <code>has:link</code> - Messages with links<br>
          <code>has:file</code> - Messages with files<br>
          <code>pinned:true</code> - Pinned messages only
        </div>

        <div id="search-results" style="
          max-height: 400px;
          overflow-y: auto;
          border: 1px solid #ddd;
          border-radius: 4px;
          padding: 12px;
        ">
          <p style="color: #999; text-align: center;">Enter search query above</p>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const searchInput = modal.querySelector('#search-input');
    const searchResults = modal.querySelector('#search-results');
    const closeBtn = modal.querySelector('#search-modal-close');

    // Close modal
    closeBtn.onclick = () => document.body.removeChild(modal);
    modal.onclick = (e) => {
      if (e.target === modal) document.body.removeChild(modal);
    };

    // Search on input
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        performSearch(e.target.value, searchResults);
      }, 300);
    });

    searchInput.focus();
  }

  // Parse Discord-style search filters
  function parseSearchQuery(query) {
    const filters = {
      text: '', // Plain text search
      from: null, // from:username
      in: null, // in:channel
      has: null, // has:link | has:file
      pinned: null, // pinned:true | pinned:false
    };

    // Extract filters
    const fromMatch = query.match(/from:(\S+)/);
    const inMatch = query.match(/in:(\S+)/);
    const hasMatch = query.match(/has:(\S+)/);
    const pinnedMatch = query.match(/pinned:(true|false)/);

    if (fromMatch) filters.from = fromMatch[1];
    if (inMatch) filters.in = inMatch[1];
    if (hasMatch) filters.has = hasMatch[1];
    if (pinnedMatch) filters.pinned = pinnedMatch[1] === 'true';

    // Remove filters from text search
    filters.text = query
      .replace(/from:\S+/g, '')
      .replace(/in:\S+/g, '')
      .replace(/has:\S+/g, '')
      .replace(/pinned:(true|false)/g, '')
      .trim();

    return filters;
  }

  // Perform search using RxDB queries
  async function performSearch(query, resultsContainer) {
    if (!query.trim()) {
      resultsContainer.innerHTML =
        '<p style="color: #999; text-align: center;">Enter search query above</p>';
      return;
    }

    const filters = parseSearchQuery(query);

    // Show loading state
    resultsContainer.innerHTML =
      '<p style="color: #999; text-align: center;">Searching...</p>';

    // Use the compat store to get all messages and filter client-side
    const messagesTable = window.store.getTable('messages');
    const allMessages = Object.entries(messagesTable || {}).map(
      ([msgId, data]) => ({
        messageId: msgId,
        username: data.username || '',
        text: data.text || '',
        timestamp: data.timestamp || 0,
        channel: data.channel || 'general',
      }),
    );

    // Apply filters
    let filteredMessages = allMessages;

    if (filters.from) {
      filteredMessages = filteredMessages.filter(
        (m) => m.username === filters.from,
      );
    }

    if (filters.in) {
      filteredMessages = filteredMessages.filter(
        (m) => m.channel === filters.in,
      );
    }

    if (filters.has === 'link') {
      filteredMessages = filteredMessages.filter((m) =>
        m.text.includes('http'),
      );
    }

    if (filters.has === 'file') {
      filteredMessages = filteredMessages.filter((m) =>
        m.text.startsWith('FILE:'),
      );
    }

    if (filters.text) {
      const searchLower = filters.text.toLowerCase();
      filteredMessages = filteredMessages.filter((m) =>
        m.text.toLowerCase().includes(searchLower),
      );
    }

    // Sort by timestamp descending and limit
    filteredMessages.sort((a, b) => b.timestamp - a.timestamp);
    const finalResults = filteredMessages.slice(0, 50);

    // Render results
    if (finalResults.length === 0) {
      resultsContainer.innerHTML =
        '<p style="color: #999; text-align: center;">No messages found</p>';
      return;
    }

    resultsContainer.innerHTML = finalResults
      .map(
        (msg) => `
        <div style="
          border-bottom: 1px solid #eee;
          padding: 8px 0;
          cursor: pointer;
        " onclick="window.jumpToMessage('${msg.messageId}', '${msg.channel}')">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <strong style="color: #333;">${msg.username}</strong>
            <span style="color: #999; font-size: 12px;">
              ${formatTimestamp(msg.timestamp)} • #${msg.channel}
            </span>
          </div>
          <div style="color: #666; font-size: 14px;">
            ${highlightText(msg.text, filters.text)}
          </div>
        </div>
      `,
      )
      .join('');
  }

  // Highlight search text in results
  function highlightText(text, searchText) {
    if (!searchText || text.startsWith('FILE:')) return escapeHtml(text);

    const escaped = escapeHtml(text);
    const regex = new RegExp(`(${escapeRegex(searchText)})`, 'gi');
    return escaped.replace(
      regex,
      '<mark style="background: #fff59d;">$1</mark>',
    );
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Jump to message in chat
  window.jumpToMessage = async function (messageId, channel = null) {
    // If channel is provided and different from current, switch to it first
    if (channel && channel !== currentChannel) {
      console.log(`Switching to channel #${channel} to show message`);
      await window.switchToChannel(channel);

      // Wait for messages to render (check up to 10 times)
      let attempts = 0;
      while (attempts < 10) {
        const msgElement = chatlog.querySelector(
          `[data-message-id="${messageId}"]`,
        );
        if (msgElement) break;

        await new Promise((resolve) => setTimeout(resolve, 100));
        attempts++;
      }
    }

    // Find the message element
    const msgElement = chatlog.querySelector(
      `[data-message-id="${messageId}"]`,
    );

    if (msgElement) {
      // Scroll to message
      msgElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Highlight message
      msgElement.style.background = '#fff59d';
      msgElement.style.transition = 'background 0.3s ease';

      setTimeout(() => {
        msgElement.style.background = '';
      }, 2000);

      // Close search modal
      const modal = document.querySelector('.search-modal-overlay');
      if (modal) document.body.removeChild(modal);
    } else {
      console.warn(`Message ${messageId} not found in current view`);
      alert('Message not found in current view');
    }
  };

  // Room settings modal
  const btnRoomSettings = document.getElementById('btn-room-settings');
  const roomSettingsModal = document.getElementById('room-settings-modal');
  const closeRoomSettings = document.getElementById('close-room-settings');

  if (btnRoomSettings && roomSettingsModal) {
    btnRoomSettings.addEventListener('click', () => {
      roomSettingsModal.classList.add('visible');
    });
  }

  if (closeRoomSettings && roomSettingsModal) {
    closeRoomSettings.addEventListener('click', () => {
      roomSettingsModal.classList.remove('visible');
    });
    roomSettingsModal.addEventListener('click', (e) => {
      if (e.target === roomSettingsModal) {
        roomSettingsModal.classList.remove('visible');
      }
    });
  }

  // Clear all messages button
  const btnClearMessages = document.getElementById('btn-clear-room-messages');
  if (btnClearMessages) {
    btnClearMessages.addEventListener('click', async () => {
      const confirmed = window.confirm(
        `Are you sure you want to clear ALL messages in "${roomname}"?\nThis action cannot be undone.`,
      );
      if (!confirmed) return;

      const store = window.store;
      if (!store) {
        alert('RxDB store is not initialized yet.');
        return;
      }

      try {
        // Use RxDB bulk operations for efficient deletion
        const db = window.rxdb;
        if (db) {
          await db.messages.find().remove();
          await db.reactions.find().remove();
        }
      } catch (err) {
        console.error('Failed to clear messages:', err);
        alert(`Failed to clear messages: ${err.message}`);
        return;
      }

      roomSettingsModal.classList.remove('visible');
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

export async function main() {
  // Initialize user state (replaces direct localStorage access)
  initUserState();

  // Go directly to room chooser
  startRoomChooser();
}

function startRoomChooser() {
  const roomFromURL = getRoomNameFromURL();
  if (roomFromURL) {
    roomname = roomFromURL;
    // Save username to localStorage when directly entering via URL
    userState.setUsername(userState.value.username);
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
    selectorNameInput.value = userState.value.username;
    selectorNameInput.addEventListener('input', (event) => {
      if (event.currentTarget.value.length > 32) {
        event.currentTarget.value = event.currentTarget.value.slice(0, 32);
      }
      const newUsername = event.currentTarget.value.trim();
      userState.setUsername(newUsername);
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
      const newUsername =
        selectorNameInput?.value.trim() || userState.value.username;
      if (newUsername.length === 0) {
        selectorNameInput?.focus();
        alert('Please enter your name');
        return;
      }
      userState.setUsername(newUsername);

      roomname = selectorRoomInput?.value.trim() || '';
      if (roomname.length > 0) {
        navigateToRoom(roomname);
      }
    });
  }

  if (selectorPrivateBtn) {
    selectorPrivateBtn.addEventListener('click', async () => {
      const newUsername =
        selectorNameInput?.value.trim() || userState.value.username;
      if (newUsername.length === 0) {
        selectorNameInput?.focus();
        alert('Please enter your name');
        return;
      }
      userState.setUsername(newUsername);

      selectorPrivateBtn.disabled = true;
      selectorPrivateBtn.textContent = 'Creating...';

      try {
        roomname = await api.createPrivateRoom();
        navigateToRoom(roomname);
      } catch (err) {
        alert('Something went wrong creating the private room');
        selectorPrivateBtn.disabled = false;
        selectorPrivateBtn.innerHTML =
          '<i class="ri-lock-2-line"></i> Create a Private Room';
      }
    });
  }

  selectorRoomInput?.focus();
}

// Show room selector in chatlog
function showRoomSelector() {
  const mainContainer = document.getElementById('main-container');
  const roomSelector = document.getElementById('room-selector');
  const spacer = document.getElementById('spacer');
  const chatInput = document.getElementById('main-chat-input-container');

  if (mainContainer) {
    mainContainer.classList.add('home-mode');
  }
  if (roomSelector) {
    roomSelector.classList.add('visible');
  }
  if (spacer) {
    spacer.style.display = 'none';
  }
  if (chatInput) {
    chatInput.style.display = 'none';
  }

  // Populate recent rooms
  populateRecentRooms();
}

// Hide room selector when entering a room
function hideRoomSelector() {
  const mainContainer = document.getElementById('main-container');
  const roomSelector = document.getElementById('room-selector');
  const spacer = document.getElementById('spacer');
  const chatInput = document.getElementById('main-chat-input-container');

  if (mainContainer) {
    mainContainer.classList.remove('home-mode');
  }
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

// Populate recent rooms list on the home page
function populateRecentRooms() {
  const section = document.getElementById('recent-rooms-section');
  const list = document.getElementById('recent-room-list');
  if (!section || !list) return;

  const rooms = getRecentRooms();
  if (rooms.length === 0) {
    section.classList.remove('has-rooms');
    return;
  }

  section.classList.add('has-rooms');
  list.innerHTML = '';

  // Use event delegation on the list container
  list.onclick = (e) => {
    const item = e.target.closest('.recent-room-item');
    if (item && item.dataset.room) {
      navigateToRoom(item.dataset.room);
    }
  };

  rooms.forEach((room) => {
    const item = document.createElement('div');
    item.className = 'recent-room-item';
    item.dataset.room = room.name;

    const icon = document.createElement('i');
    icon.className = room.isPrivate ? 'ri-lock-line' : 'ri-hashtag';
    item.appendChild(icon);

    const name = document.createElement('span');
    name.className = 'recent-room-name';
    name.textContent = room.displayName;
    item.appendChild(name);

    list.appendChild(item);
  });
}

// Room info state variables (declared at module level for WebSocket access)
let urlRoomHash = ''; // Store the room hash from URL
let roomNameLarge = document.querySelector('#room-name-large');

let documentTitlePrefix = '';
const { state: roomInfo, subscribe: subscribeRoomInfo } = createReactiveState({
  name: '',
  isLocalUpdate: false,
});

async function startChat() {
  // Hide room selector and show chat interface
  hideRoomSelector();

  // Create new deferred promise for store ready
  isStoreReady = createPromiseResolvers();

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

  // Initialize RxDB store and collections
  const { db, destroy } =
    await createRxDBStorage(roomname);
  const store = window.store; // compat store set by createRxDBStorage

  console.log('✅ RxDB database, collections, and replication initialized');

  // Initialize reaction manager (using RxDB compat store)
  window.reactionManager = new ReactionManager(
    store,
    null, // relationships not needed with RxDB
    null, // indexes not needed with RxDB
    () => userState.value.username, // getCurrentUsername
  );

  // Initialize reaction events
  initReactionEvents('#chatlog', window.reactionManager);

  // Initialize pin listener after RxDB is ready
  initPinListener();

  // Initialize read status store (local only)
  window.readStatusStore = await createReadStatusStore();

  // Resolve store ready promise
  if (isStoreReady) {
    isStoreReady.resolve();
  }

  // Initialize message list component (RxDB + Reef.js)
  let messageListComponent = null;
  try {
    messageListComponent = initMessageList(
      window.store,
      null, // indexes handled internally by RxDB
      '#chatlog',
      messagesCache, // 传入全局消息缓存
      window.readStatusStore, // 传入已读状态 store
      roomname, // 传入房间名
      undefined, // channelList - set later
      {
        getCurrentUsername: () => userState.value.username,
        getRoomDisplayName: () => documentTitlePrefix,
        isPrivateRoom: roomname.length === 64,
      },
    );
    console.log('✅ Message list component initialized');

    // Expose to window for testing
    window.messageList = messageListComponent;
    // Expose messagesSignal for P2P chat integration
    window.__messagesSignal = messageListComponent.signal;

    // Handle pending thread from initial URL (after messages are loaded)
    console.log(
      `🚀 ~ startChat ~ window._pendingThreadId:`,
      window._pendingThreadId,
    );
    if (window._pendingThreadId) {
      const threadId = window._pendingThreadId;
      delete window._pendingThreadId;
      console.log(`🔗 Opening thread from initial URL: ${threadId}`);
      // Wait a bit for messages to be loaded from WebSocket
      setTimeout(() => {
        if (window.openThread) {
          window.openThread(threadId);
        }
      }, 500);
    }

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

  // Initialize channel list component (RxDB + Reef.js)
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
    window.channelsSignal = channelListComponent.signal;
  } catch (error) {
    console.error('❌ Failed to initialize channel list:', error);
  }

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

  // Load room info from RxDB Values
  function loadRoomInfo() {
    const store = window.store;
    if (!store) return;

    const savedName = store.getValue('roomName');

    if (savedName) {
      roomInfo.name = savedName;
    }
  }

  // Save room info to RxDB Values (auto-syncs to all clients)
  function saveRoomInfo() {
    const store = window.store;
    if (!store) return;

    store.setValue('roomName', roomInfo.name);
  }

  // Listen for room info changes from other clients
  function setupRoomInfoListeners() {
    const store = window.store;
    if (!store) return;

    store.addValueListener('roomName', (store, valueId, newValue) => {
      if (newValue && newValue !== roomInfo.name) {
        roomInfo.name = newValue;
        addSystemMessage('* Room name has been updated');
      }
    });
  }

  // Initialize room info after RxDB is ready
  async function initRoomInfo() {
    // Wait for store to be ready
    await isStoreReady;
    loadRoomInfo();
    setupRoomInfoListeners();
  }

  initRoomInfo();

  // Initialize user roster component
  userRoster = initUserRoster('#roster');

  // Listen for logout event from roster
  document.querySelector('#roster').addEventListener('roster:logout', () => {
    // Clear saved username
    userState.clearUsername();
    // Close WebSocket
    if (currentWebSocket) {
      currentWebSocket.close();
    }
    // Navigate to room selector
    navigateToRoom('');
  });

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

  // Setup drag and drop for file upload
  const chatroomContainer = document.getElementById('chatroom');
  if (chatroomContainer) {
    let dragCounter = 0;
    const dropOverlay = document.createElement('div');
    dropOverlay.className = 'drop-overlay';
    dropOverlay.innerHTML = `
      <div class="drop-overlay-content">
        <i class="ri-upload-cloud-2-line" style="font-size: 64px; margin-bottom: 16px;"></i>
        <div style="font-size: 24px; font-weight: 500; margin-bottom: 8px;">Drop file to upload</div>
        <div style="font-size: 14px; opacity: 0.8;">Max ${MAX_FILE_SIZE_MB}MB</div>
      </div>
    `;
    dropOverlay.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.25);
      color: white;
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 100;
      pointer-events: none;
      border-radius: 8px;
    `;
    chatroomContainer.style.position = 'relative';
    chatroomContainer.appendChild(dropOverlay);

    // Prevent default drag behavior on chatroom container only
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
      chatroomContainer.addEventListener(
        eventName,
        (e) => {
          e.preventDefault();
          e.stopPropagation();
        },
        false,
      );
    });

    // Show overlay on drag enter
    chatroomContainer.addEventListener('dragenter', (e) => {
      dragCounter++;
      if (e.dataTransfer.types.includes('Files')) {
        dropOverlay.style.display = 'flex';
      }
    });

    // Hide overlay on drag leave
    chatroomContainer.addEventListener('dragleave', (e) => {
      dragCounter--;
      if (dragCounter === 0) {
        dropOverlay.style.display = 'none';
      }
    });

    // Handle drop
    chatroomContainer.addEventListener('drop', async (e) => {
      dragCounter = 0;
      dropOverlay.style.display = 'none';

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        // Only handle the first file
        const file = files[0];

        // Prepare replyTo info if replying to a message
        let replyToInfo = null;
        if (currentReplyTo) {
          replyToInfo = {
            messageId: currentReplyTo.messageId,
            username: currentReplyTo.username,
            preview: currentReplyTo.preview,
          };
        }

        const success = await uploadFile(file, null, replyToInfo);
        if (success && currentReplyTo) {
          // Clear reply state after successful upload
          clearReplyTo();
        }

        if (files.length > 1) {
          addSystemMessage(
            `* Note: Only the first file was uploaded (${files.length} files dropped)`,
          );
        }
      }
    });
  }

  // Thread panel close
  threadClose.addEventListener('click', (event) => {
    event.stopPropagation();
    window.closeThread();
  });

  // Thread expand/collapse toggle
  if (threadExpandToggle) {
    threadExpandToggle.addEventListener('click', (event) => {
      event.stopPropagation();
      const isExpanded = threadOriginalMessage.classList.toggle('expanded');
      const icon = threadExpandToggle.querySelector('i');
      const text = threadExpandToggle.querySelector('span');

      if (isExpanded) {
        icon.className = 'ri-arrow-up-s-line';
        text.textContent = 'Collapse';
      } else {
        icon.className = 'ri-arrow-down-s-line';
        text.textContent = 'Expand';
      }
    });
  }

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
      const currentThreadId = chatState.value.threadId;
      if (!currentThreadId) return;

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
      const currentThreadId = chatState.value.threadId;
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
    const currentThreadId = chatState.value.threadId;
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

  // Upload file function with progress tracking
  async function uploadFile(file, fileName = null, replyTo = null) {
    console.log('📤 [uploadFile] Starting upload:', {
      fileName: fileName || file.name,
      size: file.size,
    });

    const uploadFileName = fileName || file.name;
    let tempMessageId = null;

    try {
      if (file.size > MAX_FILE_SIZE_BYTES) {
        const fileSizeFormatted = formatFileSize(file.size);
        const maxSizeFormatted = formatFileSize(MAX_FILE_SIZE_BYTES);
        const errorMsg = `File is too large (${fileSizeFormatted}). Maximum allowed size is ${maxSizeFormatted}.`;

        addSystemMessage(`* Upload failed: ${errorMsg}`);
        alert(errorMsg);
        return false;
      }

      // 1. 添加临时消息到 Reef.js signal（不进 RxDB，不同步）
      tempMessageId = window.messageList.addTempMessage({
        name: userState.value.username,
        message: `FILE:${JSON.stringify({
          url: '',
          name: uploadFileName,
          type: file.type,
          size: file.size,
          uploading: true,
          uploadProgress: 0,
        })}`,
        timestamp: Date.now(),
        channel: currentChannel || 'general',
        replyToId: replyTo?.messageId || null,
      });

      // 2. 上传文件到服务器
      const result = await api.uploadFileAuto(roomname, file, {
        onProgress: (progress) => {
          window.messageList.updateTempMessage(tempMessageId, {
            message: `FILE:${JSON.stringify({
              url: '',
              name: uploadFileName,
              type: file.type,
              size: file.size,
              uploading: true,
              uploadProgress: Math.round(progress.percentage),
            })}`,
          });
        },
        onChunkComplete: (chunkInfo) => {
          console.log(
            `📦 Chunk ${chunkInfo.chunkIndex + 1}/${chunkInfo.totalChunks} uploaded`,
          );
        },
        onError: (error) => {
          console.error('❌ Upload chunk error:', error);
        },
      });

      // 3. 上传成功 - 删除临时消息，通过 WebSocket 发送真实消息
      window.messageList.removeTempMessage(tempMessageId);

      const fileMessage = `FILE:${JSON.stringify({
        url: result.fileUrl,
        name: uploadFileName,
        type: file.type,
        size: file.size,
      })}`;

      await userApi.sendMessage(fileMessage, replyTo);

      return true;
    } catch (err) {
      console.error('❌ Upload failed:', err);

      // 更新临时消息为错误状态
      if (tempMessageId) {
        window.messageList.updateTempMessage(tempMessageId, {
          message: `FILE:${JSON.stringify({
            url: '',
            name: uploadFileName,
            type: file.type,
            size: file.size,
            uploading: false,
            error: err.message,
          })}`,
        });
      }

      return false;
    }
  }

  // Initialize left sidebar with room list and user info
  initializeLeftSidebar();

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

let isStoreReady = null; // Promise that resolves when RxDB store is initialized

function join() {
  let ws = new WebSocket(api.getWebSocketUrl(roomname));
  let rejoined = false;
  let startTime = Date.now();

  let rejoin = async () => {
    if (!rejoined) {
      rejoined = true;
      currentWebSocket = null;
      isReconnecting = true; // Mark as reconnecting

      // Clear the roster
      if (userRoster) {
        userRoster.clearUsers();
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
    ws.send(JSON.stringify({ name: userState.value.username }));
  });

  let connectionReady = false;

  ws.addEventListener('message', async (event) => {
    let data = JSON.parse(event.data);

    // NOTE: Regular chat messages are now handled by RxDB WebSocket replication
    // This WebSocket only handles system events

    if (data.error) {
      addSystemMessage('* Error: ' + data.error);
    } else if (data.joined) {
      // Add user to roster (Reef.js component handles rendering)
      if (userRoster && !userRoster.hasUser(data.joined)) {
        userRoster.addUser(data.joined);

        // Only show join system message after connection is ready
        // (suppresses the initial batch of existing users on connect)
        if (connectionReady && data.joined !== userState.value.username) {
          addSystemMessage(`* ${data.joined} has joined the room`);
        }
      }
    } else if (data.quit) {
      // Remove user from roster (Reef.js component handles rendering)
      if (userRoster && userRoster.hasUser(data.quit)) {
        userRoster.removeUser(data.quit);
        if (connectionReady) {
          addSystemMessage(`* ${data.quit} has left the room`);
        }
      }
    } else if (data.ready) {
      connectionReady = true;

      if (isReconnecting) {
        updateConnectionStatus('connected');
        isReconnecting = false;

        console.log('🔄 Reconnected - RxDB will auto-sync messages');
      }

      if (chatInputComponent) {
        chatInputComponent.focus();
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
      // Name too long or invalid - clear saved username using userState
      userState.clearUsername();
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

  // Initialize channel UI features (data already in RxDB)
  if (window.channelList) {
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
      switchToChannel(channelParam);
    } else {
      // No channel specified, load messages for default channel
      loadChannelMessages(currentChannel);
    }

    // Check if there's a thread ID in the URL
    const threadParam = urlParams.get('thread');
    if (threadParam) {
      window.openThread(threadParam);
    }
  }
}

function addSystemMessage(text) {
  // Use message list component to render system messages inline with chat messages
  if (window.messageList && window.messageList.addSystemMessage) {
    window.messageList.addSystemMessage(text);
    return;
  }
  // Fallback: append directly to chatlog (before message list is initialized)
  let p = document.createElement('p');
  p.className = 'system-message';
  const sysMsg = document.createElement('system-message');
  sysMsg.setAttribute('message', text);
  p.appendChild(sysMsg);
  chatlog.appendChild(p);
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

      // Edit message in RxDB (will auto-sync to other clients)
      if (window.messageList) {
        window.messageList.editMessage(messageData.messageId, newMessage);
        console.log('✅ Message edited via RxDB');
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

// Get recent rooms with metadata for room list component
function getRecentRooms() {
  const history = getRoomHistory();
  return history.map((item) => {
    const name = item.name;
    // Private rooms are identified by 64-character hex strings
    const isPrivate = /^[0-9a-f]{64}$/.test(name);
    return {
      name,
      // Show first 8 chars of private room IDs (standard hex preview length)
      displayName: isPrivate ? name.slice(0, 8) + '...' : name,
      isPrivate,
      unreadCount: getUnreadCount(name),
    };
  });
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

// Initialize user profile modal
function initUserProfileModal() {
  const userInfoCard = document.querySelector('#user-info-card');
  const modal = document.querySelector('#user-profile-modal');
  const closeBtn = document.querySelector('#close-user-profile');
  const usernameInput = document.querySelector('#username-input');
  const previewAvatar = document.querySelector('#preview-avatar');
  const saveBtn = document.querySelector('#save-username-btn');

  // Open modal when clicking on user info card
  if (userInfoCard) {
    userInfoCard.addEventListener('click', (e) => {
      // Don't open if clicking on action buttons (though they're hidden now)
      if (e.target.closest('.user-action-btn')) return;

      if (modal && usernameInput && previewAvatar) {
        modal.classList.add('visible');
        usernameInput.value = userState.value.username || '';
        previewAvatar.setAttribute('name', userState.value.username || 'User');
      }
    });
  }

  // Close modal
  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => {
      modal.classList.remove('visible');
    });
  }

  // Close modal when clicking outside
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('visible');
      }
    });
  }

  // Update preview avatar as user types
  if (usernameInput && previewAvatar) {
    usernameInput.addEventListener('input', (e) => {
      const newName = e.target.value.trim() || 'User';
      previewAvatar.setAttribute('name', newName);
    });
  }

  // Random username button
  const randomUsernameBtn = document.querySelector('#random-username-btn');
  if (randomUsernameBtn && usernameInput && previewAvatar) {
    randomUsernameBtn.addEventListener('click', () => {
      const randomName = generateRandomUsername();
      usernameInput.value = randomName;
      previewAvatar.setAttribute('name', randomName);
      // Add a small animation effect to the icon, not the button
      const icon = randomUsernameBtn.querySelector('i');
      if (icon) {
        icon.style.transform = 'rotate(180deg)';
        setTimeout(() => {
          icon.style.transform = 'rotate(0deg)';
        }, 300);
      }
    });
  }

  // Save username
  if (saveBtn && usernameInput && modal) {
    saveBtn.addEventListener('click', () => {
      const newUsername = usernameInput.value.trim();
      if (newUsername && newUsername.length > 0 && newUsername.length <= 32) {
        userState.setUsername(newUsername);
        userState.value.username = newUsername; // Update global for backward compatibility
        modal.classList.remove('visible');
      } else {
        alert('Please enter a valid username (1-32 characters)');
      }
    });
  }

  // Allow Enter key to save
  if (usernameInput) {
    usernameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        saveBtn?.click();
      }
    });
  }
}

// Initialize room dropdown and user info when chat starts
function initializeLeftSidebar() {
  initRoomDropdown();
  updateRoomListUI();
  updateUserInfoCard();
  initUserProfileModal();
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
window.initializeLeftSidebar = initializeLeftSidebar;
window.hideLeftSidebar = hideLeftSidebar;

// ============================================
// Channel Utilities
// ============================================

/**
 * Get channels list from RxDB store
 * @param {Object} store - RxDB compat store instance
 * @returns {Array} Array of channel objects {channel, count, lastUsed}
 */
function getChannelsFromStore(store) {
  if (!store) return [];

  const channelsTable = store.getTable('channels');
  const channelsList = Object.entries(channelsTable || {})
    .map(([channelName, data]) => ({
      channel: channelName,
      count: data.count || 0,
      lastUsed: data.lastUsed || Date.now(),
    }))
    .sort((a, b) =>
      a.channel.localeCompare(b.channel, undefined, { sensitivity: 'base' }),
    );

  // Ensure general channel exists
  if (!channelsList.some((ch) => ch.channel === 'general')) {
    channelsList.push({
      channel: 'general',
      count: 0,
      lastUsed: Date.now(),
    });
  }

  return channelsList;
}

// Export for use in other modules
window.getChannelsFromStore = getChannelsFromStore;

// Cleanup RxDB resources on page unload
window.addEventListener('beforeunload', async () => {
  if (window.rxdbDestroy) {
    await window.rxdbDestroy();
  }
});
