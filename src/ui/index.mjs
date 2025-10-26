import { regex } from '../common/hashtag.mjs';

function createReactiveState(initialState) {
  const listeners = new Set();

  const proxy = new Proxy(initialState, {
    get(target, property, receiver) {
      return Reflect.get(target, property, receiver);
    },

    set(target, property, value, receiver) {
      const oldValue = target[property];
      const success = Reflect.set(target, property, value, receiver);
      if (success && oldValue !== value) {
        listeners.forEach((listener) => listener(property, value, oldValue));
      }
      return success;
    },
  });

  return {
    state: proxy,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
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
    const showPrefix = this.getAttribute('show-prefix') === 'true';

    this.innerHTML = `
        <div class="chat-input-wrapper" style="
          display: flex;
          align-items: flex-end;
          position: relative;
          width: 100%;
        ">
          ${
            showPrefix
              ? `<span class="chat-input-prefix" style="
            position: absolute;
            left: 8px;
            bottom: 8px;
            font-weight: bold;
            color: #888;
            z-index: 1;
            pointer-events: none;
          ">&gt;</span>`
              : ''
          }
          <textarea 
            class="chat-input-textarea" 
            rows="${rows}" 
            placeholder="${placeholder}"
            style="
              flex: 1;
              min-height: ${minHeight};
              max-height: ${maxHeight};
              padding: 8px;
              ${showPrefix ? 'padding-left: 24px;' : ''}
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
              accept="image/*,application/pdf,.doc,.docx,.txt"
              style="display: none;"
            >
            <button 
              type="button" 
              class="chat-input-file-btn" 
              title="Upload file"
              style="
                position: absolute;
                right: 0;
                bottom: 0;
                width: 40px;
                height: 40px;
                min-height: 40px;
                border: none;
                background: #f0f0f0;
                cursor: pointer;
                font-size: 20px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 0 4px 4px 0;
                transition: background 0.2s;
              "
            >📎</button>
          `
              : ''
          }
        </div>
      `;

    this.textarea = this.querySelector('.chat-input-textarea');
    this.fileInput = this.querySelector('.chat-input-file');
    this.fileBtn = this.querySelector('.chat-input-file-btn');
  }

  setupEventListeners() {
    if (!this.textarea) return;

    // Handle Enter key (submit on Enter, new line on Shift+Enter)
    this.textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.submit();
        return;
      }
    });

    // Auto-resize on input
    this.textarea.addEventListener('input', (event) => {
      // Limit length
      if (event.currentTarget.value.length > 6000) {
        event.currentTarget.value = event.currentTarget.value.slice(0, 6000);
      }
      this.autoResize();
    });

    // File upload button click
    if (this.fileBtn) {
      this.fileBtn.addEventListener('click', () => {
        if (this.fileInput) {
          this.fileInput.click();
        }
      });

      // Add hover effect
      this.fileBtn.addEventListener('mouseenter', () => {
        this.fileBtn.style.background = '#e0e0e0';
      });
      this.fileBtn.addEventListener('mouseleave', () => {
        this.fileBtn.style.background = '#f0f0f0';
      });
    }

    // File input change
    if (this.fileInput) {
      this.fileInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (file && this.onFileUpload) {
          await this.onFileUpload(file);
          // Clear the file input
          this.fileInput.value = '';
        }
      });
    }
  }

  autoResize() {
    if (!this.textarea) return;

    const maxHeight = parseInt(this.getAttribute('max-height')) || 150;

    this.textarea.style.height = 'auto';
    let newHeight = Math.min(this.textarea.scrollHeight, maxHeight);
    this.textarea.style.height = newHeight + 'px';

    // Update file button height if it exists
    if (this.fileBtn) {
      this.fileBtn.style.height = newHeight + 'px';
      this.fileBtn.style.minHeight = newHeight + 'px';
    }

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
  }

  connectedCallback() {
    // Get attributes
    const src = this.getAttribute('data-src');
    const alt = this.getAttribute('alt') || '';
    const maxWidth = this.getAttribute('max-width') || '300px';
    const maxHeight = this.getAttribute('max-height') || '300px';

    // Create image element with placeholder
    const img = document.createElement('img');
    img.alt = alt;
    img.style.maxWidth = maxWidth;
    img.style.maxHeight = maxHeight;
    img.style.display = 'block';
    img.style.marginTop = '5px';
    img.style.cursor = 'pointer';
    img.style.backgroundColor = '#f0f0f0'; // Placeholder background
    img.style.minHeight = '100px'; // Minimum height for placeholder

    // Set a placeholder or loading indicator
    img.src =
      'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect fill="%23f0f0f0" width="100" height="100"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23999" font-size="14"%3ELoading...%3C/text%3E%3C/svg%3E';

    // Store the real src
    this._realSrc = src;
    this._img = img;

    // Add click handler
    img.onclick = () => {
      if (this.loaded && src) {
        window.open(src, '_blank');
      }
    };

    this.appendChild(img);

    // Setup IntersectionObserver for lazy loading
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

  loadImage() {
    if (this.loaded || !this._realSrc) return;

    const img = this._img;

    // Create a new image to preload
    const tempImg = new Image();

    tempImg.onload = () => {
      // Set the real src
      img.src = this._realSrc;
      img.style.backgroundColor = 'transparent';
      img.style.minHeight = 'auto';
      this.loaded = true;

      // Handle scroll position maintenance
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
          // Use the existing scroll handler if available
          window.setupImageScrollHandler(img, scrollContainer, shouldScroll);
        } else {
          // Fallback: simple scroll to bottom if at bottom
          if (shouldScroll()) {
            scrollContainer.scrollTop = scrollContainer.scrollHeight;
          }
        }
      }

      // Dispatch loaded event
      this.dispatchEvent(
        new CustomEvent('lazy-loaded', { detail: { src: this._realSrc } }),
      );
    };

    tempImg.onerror = () => {
      console.warn('Failed to load lazy image:', this._realSrc);
      img.src =
        'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect fill="%23ffeeee" width="100" height="100"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23cc0000" font-size="12"%3ELoad Failed%3C/text%3E%3C/svg%3E';
      img.style.backgroundColor = '#ffeeee';
      img.style.cursor = 'default';
    };

    // Start loading
    tempImg.src = this._realSrc;
  }

  disconnectedCallback() {
    // Clean up observer when element is removed
    if (this.observer) {
      this.observer.disconnect();
    }
  }
}
customElements.define('lazy-img', LazyImg);

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

    // Clear existing content
    this.innerHTML = '';

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
        this.appendChild(replyRef);
      } catch (e) {
        console.error('Failed to parse replyTo:', e);
      }
    }

    // Add time if present
    if (timestamp) {
      const date = new Date(Number(timestamp));
      const hh = String(date.getHours()).padStart(2, '0');
      const mm = String(date.getMinutes()).padStart(2, '0');
      const ss = String(date.getSeconds()).padStart(2, '0');
      const timeSpan = document.createElement('span');
      timeSpan.className = 'msg-time';
      timeSpan.textContent = `[${hh}:${mm}:${ss}] `;
      timeSpan.style.color = '#888';
      timeSpan.style.fontSize = '0.95em';
      this.appendChild(timeSpan);
    }

    // Add username if present
    if (username) {
      const usernameSpan = document.createElement('span');
      usernameSpan.className = 'username';
      usernameSpan.textContent = username + ': ';
      this.appendChild(usernameSpan);
    }

    // Handle file messages (check inside the element)
    if (message.startsWith('FILE:')) {
      this.renderFileMessage(message);
    } else {
      // Handle regular text messages with link detection
      this.renderTextMessage(message);
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
      this.appendChild(document.createElement('br'));
      this.appendChild(threadIndicator);
    }
  }

  renderFileMessage(message) {
    const parts = message.substring(5).split('|');
    const fileUrl = parts[0];
    const fileName = parts[1] || 'file';
    const fileType = parts[2] || '';

    // If it's an image, display it inline with lazy loading
    if (fileType.startsWith('image/')) {
      // Use the lazy-img custom element for lazy loading
      const lazyImg = document.createElement('lazy-img');
      lazyImg.setAttribute('data-src', fileUrl);
      lazyImg.setAttribute('alt', fileName);
      lazyImg.setAttribute('max-width', '300px');
      lazyImg.setAttribute('max-height', '300px');

      this.appendChild(lazyImg);
    } else {
      // For other files, just show a download link
      const link = document.createElement('a');
      link.href = fileUrl;
      link.download = fileName;
      link.target = '_blank';
      link.textContent = '📎 ' + fileName;
      this.appendChild(link);
    }
  }

  renderTextMessage(text) {
    // Combined regex pattern - matches URLs and hashtags
    // URLs: http://, https://, and www. URLs
    // Hashtags: imported from common/hashtag.mjs
    const hashtagPattern = regex.source; // Get the pattern without the /g flag
    const combinedRegex = new RegExp(
      `(https?:\\/\\/[^\\s]+)|(www\\.[^\\s]+)|(${hashtagPattern})`,
      'g',
    );

    let lastIndex = 0;
    let match;

    // Find all URLs and hashtags in the text
    while ((match = combinedRegex.exec(text)) !== null) {
      // Add text before the match
      if (match.index > lastIndex) {
        const textNode = document.createTextNode(
          text.substring(lastIndex, match.index),
        );
        this.appendChild(textNode);
      }

      if (match[3]) {
        // It's a hashtag
        const hashtag = match[3];
        const link = document.createElement('a');
        link.className = 'hashtag';
        link.href = '#';
        link.textContent = hashtag;
        link.dataset.tag = hashtag.substring(1); // Remove the # prefix
        link.onclick = (e) => {
          e.preventDefault();
          window.filterByHashtag(link.dataset.tag);
        };
        this.appendChild(link);
      } else {
        // It's a URL
        const link = document.createElement('a');
        let url = match[0];

        // Add https:// if it's a www. link
        if (url.startsWith('www.')) {
          link.href = 'https://' + url;
        } else {
          link.href = url;
        }

        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = url;
        link.style.color = '#0066cc';
        link.style.textDecoration = 'underline';
        this.appendChild(link);
      }

      lastIndex = combinedRegex.lastIndex;
    }

    // Add remaining text after last match (or all text if no matches found)
    if (lastIndex < text.length) {
      const textNode = document.createTextNode(text.substring(lastIndex));
      this.appendChild(textNode);
    }
  }
}

// Register the custom element
customElements.define('chat-message', ChatMessage);

let currentWebSocket = null;

let nameForm = document.querySelector('#name-form');
let nameInput = document.querySelector('#name-input');
let roomForm = document.querySelector('#room-form');
let roomNameInput = document.querySelector('#room-name');
let goPublicButton = document.querySelector('#go-public');
let goPrivateButton = document.querySelector('#go-private');
let chatroom = document.querySelector('#chatroom');
let chatlog = document.querySelector('#chatlog');
let chatInputComponent = null; // Will be initialized after DOM is ready
let roster = document.querySelector('#roster');
let hashtagList = document.querySelector('#hashtag-list'); // Hashtag list in right-sidebar
let hashtagFilterBanner = document.querySelector('#hashtag-filter-banner');
let activeHashtagSpan = document.querySelector('#active-hashtag');

// Mobile room info elements
let mobileTopBar = document.querySelector('#mobile-top-bar');
let mobileTopBarTitle = document.querySelector('#mobile-top-bar-title');
let mobileTopBarArrow = document.querySelector('#mobile-top-bar-arrow');
let mobileRoomInfoOverlay = document.querySelector('#mobile-room-info-overlay');
let rightSidebar = document.querySelector('#right-sidebar');

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
let currentHashtagFilter = null; // Current active hashtag filter
let allHashtags = []; // Cache of all hashtags

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

// Thread state
let currentThreadId = null; // Currently open thread
let messagesCache = new Map(); // messageId -> message data
let threadsCache = new Map(); // messageId -> array of reply messages

// Reply state for main chat input
let currentReplyTo = null; // {messageId, username, preview, rootMessageId}

// Generate UUID v4 using crypto.randomUUID or fallback
function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Generate message ID from timestamp and username for legacy messages
function generateLegacyMessageId(timestamp, username) {
  return `${timestamp}-${username}`;
}

let hostname = window.location.host;
if (hostname == '') {
  // Probably testing the HTML locally.
  hostname = 'edge-chat-demo.cloudflareworkers.com';
}

// API Client class for server requests
class ChatAPI {
  constructor(hostname) {
    this.hostname = hostname;
    this.baseUrl = `https://${hostname}/api`;
  }

  // Create private room
  async createPrivateRoom() {
    const response = await fetch(`${this.baseUrl}/room`, { method: 'POST' });
    if (!response.ok) {
      throw new Error('Failed to create private room');
    }
    return await response.text();
  }

  // Get hashtags for a room
  async getHashtags(roomName) {
    const response = await fetch(`${this.baseUrl}/room/${roomName}/hashtags`);
    if (!response.ok) {
      throw new Error('Failed to load hashtags');
    }
    return await response.json();
  }

  // Get room info
  async getRoomInfo(roomName) {
    const response = await fetch(`${this.baseUrl}/room/${roomName}/info`);
    if (!response.ok) {
      throw new Error('Failed to load room info');
    }
    return await response.json();
  }

  // Update room info
  async updateRoomInfo(roomName, data) {
    const response = await fetch(`${this.baseUrl}/room/${roomName}/info`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      throw new Error('Failed to save room info');
    }
    return await response.json();
  }

  // Upload file
  async uploadFile(roomName, formData) {
    const response = await fetch(`${this.baseUrl}/room/${roomName}/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Upload failed');
    }
    return await response.json();
  }

  // Get thread replies
  async getThreadReplies(roomName, messageId, nested = true) {
    const response = await fetch(
      `${this.baseUrl}/room/${roomName}/thread/${messageId}?nested=${nested}`,
    );
    if (!response.ok) {
      throw new Error('Failed to load thread');
    }
    return await response.json();
  }

  // Get WebSocket URL
  getWebSocketUrl(roomName) {
    const wss = window.location.protocol === 'http:' ? 'ws://' : 'wss://';
    return `${wss}${this.hostname}/api/room/${roomName}/websocket`;
  }
}

// Initialize API client
const api = new ChatAPI(hostname);

// User message API - handles sending messages through WebSocket
class UserMessageAPI {
  /**
   * Send a text message
   * @param {string} message - The message text to send
   * @param {object} replyTo - Optional reply information {messageId, username, preview}
   */
  sendMessage(message, replyTo = null) {
    if (!currentWebSocket || !message || message.length === 0) {
      return false;
    }

    const payload = { message: message };

    // Include replyTo information if provided
    if (replyTo) {
      payload.replyTo = {
        messageId: replyTo.messageId,
        username: replyTo.username,
        preview: replyTo.preview,
      };
    }

    currentWebSocket.send(JSON.stringify(payload));

    // Scroll to bottom whenever sending a message
    chatlog.scrollBy(0, 1e8);
    // Set flag to scroll when we receive our own message back
    isAtBottom = true;

    return true;
  }

  /**
   * Send a file message
   * @param {string} fileUrl - The uploaded file URL
   * @param {string} fileName - The file name
   * @param {string} fileType - The file MIME type
   * @param {object} replyTo - Optional reply information {messageId, username, preview}
   */
  sendFileMessage(fileUrl, fileName, fileType, replyTo = null) {
    const fileMessage = `FILE:${fileUrl}|${fileName}|${fileType}`;
    return this.sendMessage(fileMessage, replyTo);
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
  threadPanel.classList.add('visible');
  chatlog.classList.add('thread-open');

  // Also hide main chat input on mobile
  const mainInputContainer = document.getElementById(
    'main-chat-input-container',
  );
  if (mainInputContainer) {
    mainInputContainer.classList.add('thread-open');
  }

  // Prevent body scroll on mobile when thread is open
  if (window.innerWidth <= 600) {
    document.body.classList.add('thread-open');
  }

  // Update URL with thread ID
  const url = new URL(window.location);
  url.searchParams.set('thread', rootMessageId);
  window.history.pushState({}, '', url);

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

  // Remove thread parameter from URL
  const url = new URL(window.location);
  url.searchParams.delete('thread');
  window.history.pushState({}, '', url);
  threadPanel.classList.remove('visible');
  chatlog.classList.remove('thread-open');

  // Show main chat input again
  const mainInputContainer = document.getElementById(
    'main-chat-input-container',
  );
  if (mainInputContainer) {
    mainInputContainer.classList.remove('thread-open');
  }

  // Restore body scroll on mobile
  document.body.classList.remove('thread-open');

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

// Recursively collect all replies in a thread (depth-first traversal)
function collectAllThreadReplies(rootMessageId) {
  const allReplies = [];
  const visited = new Set();

  function collectReplies(messageId) {
    if (visited.has(messageId)) return;
    visited.add(messageId);

    // Get direct replies from threadsCache
    const directReplies = threadsCache.get(messageId) || [];

    for (const reply of directReplies) {
      allReplies.push(reply);
      // Recursively collect replies to this reply
      collectReplies(reply.messageId);
    }
  }

  collectReplies(rootMessageId);
  return allReplies;
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
    // Load all thread replies from server in one request
    // Server should return all nested replies in a flat array
    const data = await api.getThreadReplies(roomname, messageId, true);
    const allReplies = data.replies || [];

    // Cache all replies in messagesCache and organize by parent
    const replyMap = new Map();
    allReplies.forEach((reply) => {
      // Cache the message
      messagesCache.set(reply.messageId, reply);

      // Organize by parent messageId for threadsCache
      const parentId = reply.replyTo?.messageId;
      if (parentId) {
        if (!replyMap.has(parentId)) {
          replyMap.set(parentId, []);
        }
        replyMap.get(parentId).push(reply);
      }
    });

    // Update threadsCache with organized replies
    replyMap.forEach((replies, parentId) => {
      threadsCache.set(parentId, replies);
    });

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
  } catch (err) {
    console.error('Failed to load thread replies:', err);
    threadReplies.innerHTML =
      '<p style="color:#999;padding:16px;text-align:center;">Failed to load replies</p>';
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

  if (data.replyTo) {
    chatMessage.setAttribute('reply-to', JSON.stringify(data.replyTo));
  }

  if (data.threadInfo && data.threadInfo.replyCount > 0) {
    chatMessage.setAttribute(
      'thread-count',
      String(data.threadInfo.replyCount),
    );
  }

  p.appendChild(chatMessage);
  wrapper.appendChild(p);

  // Add message actions
  const actions = document.createElement('div');
  actions.className = 'message-actions';

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
    actions.appendChild(locateBtn);
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
    actions.appendChild(replyBtn);
  }

  wrapper.appendChild(actions);

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

// Hashtag functionality
window.filterByHashtag = function (tag) {
  currentHashtagFilter = tag;
  activeHashtagSpan.textContent = '#' + tag;
  hashtagFilterBanner.classList.add('visible');

  // Update URL with hashtag filter
  const url = new URL(window.location);
  url.searchParams.set('tag', tag);
  window.history.pushState({}, '', url);

  // Update active state in hashtag list
  document.querySelectorAll('.hashtag-item').forEach((item) => {
    if (item.dataset.tag === tag) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Filter messages in chatlog
  const elements = chatlog.querySelectorAll('p.system-message');
  elements.forEach((elem) => {
    elem.style.display = 'none';
  });

  const messageWrappers = chatlog.querySelectorAll('div.message-wrapper');
  messageWrappers.forEach((wrapper) => {
    const chatMessage = wrapper.querySelector('chat-message');
    if (chatMessage) {
      const text = chatMessage.getAttribute('message') || '';
      const hasTag = text.toLowerCase().includes('#' + tag.toLowerCase());
      wrapper.style.display = hasTag ? 'block' : 'none';
    }
  });

  // Scroll to bottom
  chatlog.scrollBy(0, 1e8);
};

window.clearHashtagFilter = function () {
  currentHashtagFilter = null;
  hashtagFilterBanner.classList.remove('visible');

  // Remove tag from URL
  const url = new URL(window.location);
  url.searchParams.delete('tag');
  window.history.pushState({}, '', url);

  // Clear active state
  document.querySelectorAll('.hashtag-item').forEach((item) => {
    item.classList.remove('active');
  });

  // Show all messages
  const messages = chatlog.querySelectorAll('p.system-message');
  messages.forEach((msg) => {
    msg.style.display = 'block';
  });
  const messageWrappers = chatlog.querySelectorAll('div.message-wrapper');
  messageWrappers.forEach((wrapper) => {
    wrapper.style.display = 'block';
  });

  // Scroll to bottom
  chatlog.scrollBy(0, 1e8);
};

async function loadHashtags() {
  try {
    const data = await api.getHashtags(roomname);
    allHashtags = data.hashtags || [];
    renderHashtagList();
  } catch (err) {
    console.error('Failed to load hashtags:', err);
  }
}

function renderHashtagList() {
  if (!hashtagList) return;

  hashtagList.innerHTML = '';

  if (allHashtags.length === 0) {
    hashtagList.innerHTML =
      '<div style="color:#999;font-size:0.85em;padding:8px;">No hashtags yet.<br>Use #tag in messages!</div>';
    return;
  }

  allHashtags.forEach((item) => {
    const div = document.createElement('div');
    div.className = 'hashtag-item';
    div.dataset.tag = item.tag;
    if (currentHashtagFilter === item.tag) {
      div.classList.add('active');
    }

    const nameSpan = document.createElement('span');
    nameSpan.className = 'hashtag-name';
    nameSpan.textContent = '#' + item.tag;
    div.appendChild(nameSpan);

    const countSpan = document.createElement('span');
    countSpan.className = 'hashtag-count';
    countSpan.textContent = item.count || 0;
    div.appendChild(countSpan);

    div.onclick = () => {
      window.filterByHashtag(item.tag);
    };

    hashtagList.appendChild(div);
  });
}

function updateHashtagsOnNewMessage(message) {
  // Extract hashtags from message
  const matches = [...message.matchAll(regex)];

  if (matches.length > 0) {
    // Reload hashtags after a short delay to get updated counts
    setTimeout(() => loadHashtags(), 500);
  }
}

// Room history management
function getRoomHistory() {
  const history = localStorage.getItem('chatRoomHistory');
  return history ? JSON.parse(history) : [];
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
}

function displayRoomHistory() {
  const historyList = document.querySelector('#room-history-list');
  const history = getRoomHistory();

  if (history.length === 0) {
    document.querySelector('#room-history').style.display = 'none';
    return;
  }

  document.querySelector('#room-history').style.display = 'block';
  historyList.innerHTML = '';

  history.forEach((item) => {
    const div = document.createElement('div');
    div.className = 'room-history-item';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'room-name';
    nameSpan.innerText =
      item.name.length === 64 ? 'Private Room' : '#' + item.name;
    nameSpan.title = 'Click to enter ' + item.name;
    div.appendChild(nameSpan);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.innerText = '×';
    removeBtn.title = 'Remove from history';
    removeBtn.onclick = (e) => {
      e.stopPropagation();
      removeFromRoomHistory(item.name);
      displayRoomHistory();
    };
    div.appendChild(removeBtn);

    div.onclick = () => {
      roomname = item.name;
      startChat();
    };

    historyList.appendChild(div);
  });
}

export function startNameChooser() {
  // Bind event listeners first
  nameForm.addEventListener('submit', (event) => {
    event.preventDefault();
    username = nameInput.value.trim();
    if (username.length > 0) {
      // Save username to localStorage
      localStorage.setItem('chatUsername', username);
      startRoomChooser();
    }
  });

  nameInput.addEventListener('input', (event) => {
    if (event.currentTarget.value.length > 32) {
      event.currentTarget.value = event.currentTarget.value.slice(0, 32);
    }
  });

  // Check if username is saved in localStorage
  const savedUsername = localStorage.getItem('chatUsername');
  if (savedUsername) {
    // Pre-fill the username
    nameInput.value = savedUsername;

    // Only auto-submit if we have a room hash in URL
    if (document.location.hash.length > 1) {
      setTimeout(() => {
        nameForm.dispatchEvent(new Event('submit'));
      }, 0);
      return;
    }
  }

  nameInput.focus();
}

function startRoomChooser() {
  nameForm.remove();

  if (document.location.hash.length > 1) {
    roomname = document.location.hash.slice(1);
    startChat();
    return;
  }

  // Display room history
  displayRoomHistory();

  roomForm.addEventListener('submit', (event) => {
    event.preventDefault();
    roomname = roomNameInput.value;
    if (roomname.length > 0) {
      startChat();
    }
  });

  roomNameInput.addEventListener('input', (event) => {
    if (event.currentTarget.value.length > 32) {
      event.currentTarget.value = event.currentTarget.value.slice(0, 32);
    }
  });

  goPublicButton.addEventListener('click', (event) => {
    roomname = roomNameInput.value;
    if (roomname.length > 0) {
      startChat();
    }
  });

  goPrivateButton.addEventListener('click', async (event) => {
    roomNameInput.disabled = true;
    goPublicButton.disabled = true;
    event.currentTarget.disabled = true;

    try {
      roomname = await api.createPrivateRoom();
      startChat();
    } catch (err) {
      alert('something went wrong');
      document.location.reload();
    }
  });

  roomNameInput.focus();
}

// Room info state variables (declared at module level for WebSocket access)
let urlRoomHash = ''; // Store the room hash from URL
let roomInfoNameDisplay = document.querySelector('#room-name-display');
let roomInfoNameInput = document.querySelector('#room-name-input');
let roomInfoNoteTextarea = document.querySelector('#room-note');
let roomInfoDescriptionLabel = document.querySelector(
  '#room-description-label',
);

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
let btnExportRecords = null;
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
    addSystemMessage('* This room has been destroyed. Redirecting...');
    setTimeout(() => {
      window.location.href = '/';
    }, 2000);
  }
}

function startChat() {
  roomForm.remove();

  // Show right sidebar
  const rightSidebar = document.querySelector('#right-sidebar');
  if (rightSidebar) {
    rightSidebar.classList.add('visible');
  }

  // Normalize the room name a bit.
  roomname = roomname
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .replace(/_/g, '-')
    .toLowerCase();

  if (roomname.length > 32 && !roomname.match(/^[0-9a-f]{64}$/)) {
    addSystemMessage('ERROR: Invalid room name.');
    return;
  }

  document.location.hash = '#' + roomname;

  // Save to room history
  addToRoomHistory(roomname);

  // Initialize reactive room info state
  const initialRoomName =
    roomname.length === 64 ? 'Private Room' : '#' + roomname;
  urlRoomHash = roomname.length === 64 ? '' : '#' + roomname;
  roomInfo.name = initialRoomName;

  // Set up reactive listener for document title updates
  subscribeRoomInfo((property, newValue, oldValue) => {
    if (property === 'name') {
      roomInfoNameDisplay.textContent = newValue;

      // Update mobile top bar title
      if (mobileTopBarTitle) {
        mobileTopBarTitle.textContent = newValue;
      }

      // Update document title
      let title = newValue;
      if (newValue && newValue !== roomname && urlRoomHash) {
        title = newValue + ' ' + urlRoomHash;
      }
      documentTitlePrefix = title;
      document.title = documentTitlePrefix + ' - Workers Chat';
    } else if (property === 'description') {
      roomInfoNoteTextarea.value = newValue;

      // Show or hide textarea based on content
      if (newValue.trim()) {
        roomInfoNoteTextarea.classList.add('visible');
      } else {
        roomInfoNoteTextarea.classList.remove('visible');
      }
    }
  });

  // Set initial display
  roomInfoNameDisplay.textContent = roomInfo.name;
  if (mobileTopBarTitle) {
    mobileTopBarTitle.textContent = roomInfo.name;
  }
  documentTitlePrefix = roomInfo.name;
  document.title = documentTitlePrefix + ' - Workers Chat';

  // Load room info from server
  async function loadRoomInfo() {
    try {
      const data = await api.getRoomInfo(roomname);
      if (data.name) {
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

  // Load room info and hashtags on start
  loadRoomInfo();
  loadHashtags();

  // Room name editing
  roomInfoNameDisplay.addEventListener('click', (event) => {
    event.stopPropagation();
    roomInfoNameDisplay.style.display = 'none';
    roomInfoNameInput.style.display = 'block';
    roomInfoNameInput.value = roomInfo.name;
    roomInfoNameInput.focus();
    roomInfoNameInput.select();
  });

  roomInfoNameInput.addEventListener('blur', () => {
    const newName = roomInfoNameInput.value.trim();
    if (newName && newName !== roomInfo.name) {
      roomInfo.isLocalUpdate = true;
      roomInfo.name = newName;
      saveRoomInfo();
      // Reset flag after a short delay
      setTimeout(() => {
        roomInfo.isLocalUpdate = false;
      }, 500);
    }
    roomInfoNameInput.style.display = 'none';
    roomInfoNameDisplay.style.display = 'block';
  });

  roomInfoNameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      roomInfoNameInput.blur();
    } else if (event.key === 'Escape') {
      roomInfoNameInput.value = roomInfo.name;
      roomInfoNameInput.blur();
    }
  });

  roomInfoNameInput.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  // Room description editing
  roomInfoDescriptionLabel.addEventListener('click', (event) => {
    event.stopPropagation();
    roomInfoNoteTextarea.classList.add('visible');
    roomInfoNoteTextarea.focus();
  });

  // Save room note on change (debounced)
  let saveNoteTimeout;
  roomInfoNoteTextarea.addEventListener('input', () => {
    clearTimeout(saveNoteTimeout);
    saveNoteTimeout = setTimeout(() => {
      roomInfo.isLocalUpdate = true;
      roomInfo.description = roomInfoNoteTextarea.value;
      saveRoomInfo();
      // Reset flag after a short delay
      setTimeout(() => {
        roomInfo.isLocalUpdate = false;
      }, 500);
    }, 1000);
  });

  roomInfoNoteTextarea.addEventListener('blur', () => {
    // Hide textarea if empty
    if (!roomInfoNoteTextarea.value.trim()) {
      roomInfoNoteTextarea.classList.remove('visible');
    }
  });

  // Prevent the room note textarea from losing focus
  roomInfoNoteTextarea.addEventListener('mousedown', (event) => {
    event.stopPropagation();
  });

  roomInfoNoteTextarea.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  // Room Destruction Management - Initialize DOM elements
  destructionCountdown = document.querySelector('#destruction-countdown');
  countdownTime = document.querySelector('#countdown-time');
  btnStartDestruction = document.querySelector('#btn-start-destruction');
  btnCancelDestruction = document.querySelector('#btn-cancel-destruction');
  btnExportRecords = document.querySelector('#btn-export-records');
  destructionTimerSelect = document.querySelector('#destruction-timer');

  // Start destruction countdown
  async function startDestruction() {
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
      const response = await fetch(`/api/room/${roomname}/destruction/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes }),
      });

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
    }
  }

  // Cancel destruction
  async function cancelDestruction() {
    if (!confirm('Cancel room destruction?')) {
      return;
    }

    try {
      const response = await fetch(`/api/room/${roomname}/destruction/cancel`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to cancel destruction');
      }

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

      addSystemMessage('* Room destruction cancelled');
    } catch (err) {
      console.error('Failed to cancel destruction:', err);
      alert('Failed to cancel room destruction');
    }
  }

  // Export all records
  async function exportRecords() {
    try {
      addSystemMessage('* Exporting all records and files...');

      const response = await fetch(`/api/room/${roomname}/export`);
      if (!response.ok) {
        throw new Error('Failed to export records');
      }

      // Get the blob directly (ZIP file)
      const blob = await response.blob();

      // Extract filename from Content-Disposition header if available
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `chat-export-${roomname}-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}.zip`;

      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+)"/);
        if (filenameMatch && filenameMatch[1]) {
          filename = filenameMatch[1];
        }
      }

      // Create a downloadable file
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      addSystemMessage('* Export completed successfully (ZIP with all files)');
    } catch (err) {
      console.error('Failed to export records:', err);
      addSystemMessage('* Failed to export records');
    }
  }

  // Bind event listeners
  btnStartDestruction.addEventListener('click', startDestruction);
  btnCancelDestruction.addEventListener('click', cancelDestruction);
  btnExportRecords.addEventListener('click', exportRecords);

  // Prevent form submission (we handle it via custom events)
  chatroom.addEventListener('submit', (event) => {
    event.preventDefault();
  });

  // Initialize chat input component
  chatInputComponent = document.querySelector('#chat-input');
  threadInputComponent = document.querySelector('#thread-input');

  // Setup main chat input
  if (chatInputComponent) {
    // Handle resize events from the component
    chatInputComponent.addEventListener('resize', (event) => {
      const newHeight = event.detail.height;

      // Adjust hashtag toggle button position
      let hashtagBtn = document.querySelector('#hashtag-toggle');
      hashtagBtn.style.bottom = newHeight + 'px';

      // Adjust chatlog, right-sidebar, hashtag panel, and thread panel bottom position
      chatlog.style.bottom = newHeight + 'px';
      let rightSidebar = document.querySelector('#right-sidebar');
      if (rightSidebar) {
        rightSidebar.style.bottom = newHeight + 'px';
      }
      if (hashtagPanel) {
        hashtagPanel.style.bottom = newHeight + 'px';
      }
      if (threadPanel) {
        threadPanel.style.bottom = newHeight + 'px';
      }
    });

    // Handle submit events from the component
    chatInputComponent.addEventListener('submit', (event) => {
      const message = event.detail.message;

      if (message.length > 0) {
        // Send message using userApi
        const sent = userApi.sendMessage(message, currentReplyTo);

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

  // Mobile top bar toggle
  if (mobileTopBar) {
    mobileTopBar.addEventListener('click', (event) => {
      event.stopPropagation();
      const isOpen = rightSidebar.classList.contains('mobile-visible');
      if (isOpen) {
        rightSidebar.classList.remove('mobile-visible');
        mobileRoomInfoOverlay.classList.remove('visible');
        mobileTopBarArrow.classList.remove('open');
      } else {
        rightSidebar.classList.add('mobile-visible');
        mobileRoomInfoOverlay.classList.add('visible');
        mobileTopBarArrow.classList.add('open');
        // Load hashtags when opening the sidebar
        loadHashtags();
      }
    });
  }

  // Close mobile room info when clicking overlay
  if (mobileRoomInfoOverlay) {
    mobileRoomInfoOverlay.addEventListener('click', () => {
      rightSidebar.classList.remove('mobile-visible');
      mobileRoomInfoOverlay.classList.remove('visible');
      mobileTopBarArrow.classList.remove('open');
    });
  }

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

    const originalMessage = messagesCache.get(currentThreadId);
    if (!originalMessage) return;

    // Prepare replyTo information
    const replyTo = {
      messageId: currentThreadId,
      username: originalMessage.name,
      preview: originalMessage.message.substring(0, 100),
    };

    // Send reply using userApi
    const sent = userApi.sendMessage(message, replyTo);

    if (sent) {
      threadInputComponent.clear();
    }
  }

  // Upload file function
  async function uploadFile(file, fileName = null, replyTo = null) {
    try {
      // Create form data
      const formData = new FormData();
      formData.append('file', file, fileName || file.name);

      // Upload file
      const result = await api.uploadFile(roomname, formData);

      // Send file message using userApi
      userApi.sendFileMessage(
        result.fileUrl,
        result.fileName,
        result.fileType,
        replyTo,
      );

      return true;
    } catch (err) {
      addSystemMessage('* Upload failed: ' + err.message);
      return false;
    }
  }

  // Detect mobile keyboard appearing and disappearing, and adjust the scroll as appropriate.
  if ('visualViewport' in window) {
    window.visualViewport.addEventListener('resize', function (event) {
      if (isAtBottom) {
        chatlog.scrollBy(0, 1e8);
      }
    });
  }

  join();
}

let lastSeenTimestamp = 0;
let wroteWelcomeMessages = false;
let isReconnecting = false; // Track if this is a reconnection

function join() {
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

  ws.addEventListener('open', (event) => {
    currentWebSocket = ws;

    // Send user info message.
    ws.send(JSON.stringify({ name: username }));
  });

  ws.addEventListener('message', (event) => {
    let data = JSON.parse(event.data);

    if (data.error) {
      addSystemMessage('* Error: ' + data.error);
    } else if (data.threadUpdate) {
      // Thread info has been updated
      const msgElement = document.querySelector(
        `[data-message-id="${data.threadUpdate.messageId}"]`,
      );
      if (msgElement) {
        const chatMessage = msgElement.querySelector('chat-message');
        if (chatMessage && data.threadUpdate.threadInfo) {
          chatMessage.setAttribute(
            'thread-count',
            String(data.threadUpdate.threadInfo.replyCount),
          );
          chatMessage.render(); // Re-render to show updated thread count
        }
      }

      // Update cache
      const cachedMsg = messagesCache.get(data.threadUpdate.messageId);
      if (cachedMsg) {
        cachedMsg.threadInfo = data.threadUpdate.threadInfo;
      }

      // If this is the current open thread, update the top message display
      if (currentThreadId === data.threadUpdate.messageId) {
        const rootMessage = messagesCache.get(currentThreadId);
        if (rootMessage) {
          threadOriginalMessage.innerHTML = '';
          const msgElement = createMessageElement(rootMessage, false, true);
          threadOriginalMessage.appendChild(msgElement);
        }
      }
    } else if (data.roomInfoUpdate) {
      // Room info has been updated, refresh the display
      // Skip if this is our own update to avoid flickering
      if (!roomInfo.isLocalUpdate) {
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

        // Show a notification that room info was updated
        if (updated) {
          addSystemMessage('* Room info has been updated');
        }
      }
    } else if (data.destructionUpdate) {
      // Handle room destruction updates
      handleDestructionUpdate(data.destructionUpdate);
    } else if (data.joined) {
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
          // Reload page without hash to start fresh
          window.location.href = window.location.href.split('#')[0];
        };
        userItem.appendChild(logoutBtn);
      }

      roster.appendChild(userItem);
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
    } else if (data.ready) {
      // All pre-join messages have been delivered.
      if (!wroteWelcomeMessages) {
        wroteWelcomeMessages = true;
        addSystemMessage(
          '* This is a app built with Cloudflare Workers Durable Objects. The source code ' +
            'can be found at: https://github.com/bytemain/workers-chat',
        );
        addSystemMessage(
          '* WARNING: Participants in this chat are random people on the internet. ' +
            'Names are not authenticated; anyone can pretend to be anyone.Chat history is saved.',
        );
        if (roomname.length == 64) {
          addSystemMessage(
            '* This is a private room. You can invite someone to the room by sending them the URL.',
          );
        } else {
          addSystemMessage('* Welcome to ' + documentTitlePrefix + '. Say hi!');
        }

        loadHashtags().then(() => {
          // Check if there's a tag filter in the URL
          const urlParams = new URLSearchParams(window.location.search);
          const tagParam = urlParams.get('tag');
          if (tagParam) {
            // Apply the filter from URL
            window.filterByHashtag(tagParam);
          }

          // Check if there's a thread ID in the URL
          const threadParam = urlParams.get('thread');
          if (threadParam) {
            window.openThread(threadParam);
          }
        });
      } else if (isReconnecting) {
        // Show connected status if this is a reconnection
        updateConnectionStatus('connected');
        // Reset reconnecting flag (status already updated in 'open' event)
        isReconnecting = false;
      }
    } else {
      // A regular chat message.
      if (data.timestamp > lastSeenTimestamp) {
        addChatMessage(data.name, data.message, data.timestamp, {
          messageId: data.messageId,
          replyTo: data.replyTo,
          threadInfo: data.threadInfo,
        });
        lastSeenTimestamp = data.timestamp;

        // Scroll to bottom if we were at bottom (includes our own messages)
        if (isAtBottom) {
          chatlog.scrollBy(0, 1e8);
        }
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
}

// Global variable for cross-day pagination
let lastMsgDateStr = null;

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

function addChatMessage(name, text, ts, msgData = {}) {
  // ts: message timestamp (ms)
  let timestamp = ts;
  if (typeof timestamp !== 'number') {
    timestamp = Date.now();
  }

  // Generate or use existing messageId
  const messageId =
    msgData.messageId || generateLegacyMessageId(timestamp, name);

  // Create complete message data
  const messageData = {
    name: name,
    message: text,
    timestamp: timestamp,
    messageId: messageId,
    replyTo: msgData.replyTo || null,
    threadInfo: msgData.threadInfo || null,
  };

  // Cache the message
  messagesCache.set(messageId, messageData);

  const date = new Date(timestamp);
  const dateStr =
    date.getFullYear() +
    '-' +
    String(date.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(date.getDate()).padStart(2, '0');

  // Insert date divider if day changes
  if (lastMsgDateStr !== dateStr) {
    lastMsgDateStr = dateStr;
    const divider = document.createElement('div');
    divider.className = 'date-divider';
    divider.textContent = dateStr;
    divider.style.textAlign = 'center';
    divider.style.color = '#aaa';
    divider.style.fontSize = '0.9em';
    divider.style.margin = '16px 0 8px 0';
    chatlog.appendChild(divider);
  }

  // Create message element using new function
  const messageElement = createMessageElement(messageData, false);

  // Check if message should be hidden based on current filter
  if (currentHashtagFilter) {
    const hasTag = text
      .toLowerCase()
      .includes('#' + currentHashtagFilter.toLowerCase());
    if (!hasTag) {
      messageElement.style.display = 'none';
    }
  }

  // Append message to main chat
  chatlog.appendChild(messageElement);

  // If this is a reply and the thread is open, also add to thread panel
  if (msgData.replyTo) {
    // Find the root message of this reply
    let rootId = msgData.replyTo.messageId;
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
      rootMessage.threadInfo.lastReplyTime = timestamp;

      // Update the message in main chat list
      const mainChatMsg = document.querySelector(
        `[data-message-id="${rootId}"]`,
      );
      if (mainChatMsg) {
        const chatMessage = mainChatMsg.querySelector('chat-message');
        if (chatMessage) {
          chatMessage.setAttribute('thread-count', String(totalReplies));
          chatMessage.render();
        }
      }
    }

    // If this reply belongs to the currently open thread, add it
    if (currentThreadId === rootId) {
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

  if (isAtBottom) {
    chatlog.scrollBy(0, 1e8);
  }

  // Update hashtags if message contains any
  updateHashtagsOnNewMessage(text);
}

// Listen for hash changes to switch rooms
window.addEventListener('hashchange', () => {
  const newRoomName = document.location.hash.slice(1);
  // Only reload if we're in a different room (not initial room setup)
  if (roomname && newRoomName !== roomname) {
    window.location.reload();
  }
});

// Listen for browser back/forward button to handle thread navigation
window.addEventListener('popstate', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const threadParam = urlParams.get('thread');

  if (threadParam) {
    // Open the thread if it's in the URL
    if (currentThreadId !== threadParam) {
      window.openThread(threadParam);
    }
  } else {
    // Close the thread if there's no thread parameter
    if (currentThreadId) {
      window.closeThread();
    }
  }
});
