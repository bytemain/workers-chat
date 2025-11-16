import { signal, component } from 'reefjs';
import { getIndexes, IndexesIds, TableIds } from '../../tinybase/index.mjs';
import { attr, clsx, html, raw } from '../../utils/html.mjs';
import { REACTION_TYPES } from '../../reactions/config.mjs';
import { renderReactions } from '../../reactions/ui.mjs';

/**
 * @typedef {Object} MessageData
 * @property {string} messageId - Unique message identifier
 * @property {string} name - Username of the message author
 * @property {string} message - Message text content (may be encrypted)
 * @property {number} timestamp - Unix timestamp in milliseconds
 * @property {string} channel - Channel name where the message was sent
 * @property {string|null} replyToId - ID of the message being replied to, if any
 * @property {number|null} editedAt - Unix timestamp of last edit, if edited
 * @property {boolean} encrypted - Whether the message content is encrypted
 * @property {number} [uploadProgress] - File upload progress (0-100), if uploading
 * @property {string} [uploadStatus] - Upload status: 'uploading', 'success', 'error'
 * @property {Object} [replyTo] - Reply context with messageId, username, preview
 * @property {Object} [threadInfo] - Thread info with replyCount, lastReplyTime
 */

/**
 * Reactive Message Element Web Component
 *
 * Features:
 * - Automatically updates when data changes (via Reef.js signals)
 * - Scoped state per component instance (via UUID namespace)
 * - Efficient DOM diffing (only updates what changed)
 *
 * Usage:
 *   const msgEl = document.createElement('message-element');
 *   msgEl.setData({ messageId: 'msg-123', name: 'Alice', ... });
 *   container.appendChild(msgEl);
 *
 *   // Update progress (triggers automatic re-render)
 *   msgEl.updateProgress(50);
 */
class MessageElement extends HTMLElement {
  constructor() {
    super();

    // Create unique namespace for this component instance
    this.uuid = crypto.randomUUID();

    // Create reactive signal for message data (scoped to this instance)
    this.data = signal(
      {
        messageId: '',
        name: '',
        message: '',
        timestamp: Date.now(),
        channel: 'general',
        replyToId: null,
        editedAt: null,
        encrypted: false,
        uploadProgress: null,
        uploadStatus: null,
        replyTo: null,
        threadInfo: null,
        isInThread: false,
        isThreadOriginal: false,
        isFirstInGroup: true, // Whether this is the first message in a user group
      },
      this.uuid,
    );

    // Event handlers (accessible in template via onclick="eventName()")
    this.events = {
      handleReaction: (event) => {
        const btn = event.target.closest('.quick-reaction-btn');
        const reactionId = btn ? btn.getAttribute('data-reaction-id') : null;
        if (!reactionId) {
          console.error('No reaction ID found on button');
          return;
        }
        console.log('Quick reaction:', reactionId, 'on', this.data.messageId);
        if (window.reactionManager) {
          window.reactionManager.toggleReaction(
            this.data.messageId,
            reactionId,
          );
        }
      },

      handleReply: () => {
        const preview = this.data.message.substring(0, 50);
        window.setReplyTo?.(
          this.data.messageId,
          this.data.name,
          preview,
          this.data.messageId,
        );
      },

      handleLocate: () => {
        window.locateMessageInMainChat?.(this.data.messageId);
      },

      handleOpenThread: () => {
        window.openThread?.(this.data.messageId);
      },

      handleShowMoreActions: (event) => {
        event.stopPropagation();
        window.showMessageActionsMenu?.(
          event.target,
          this.data,
          this.data.isInThread,
          this.data.isThreadOriginal,
        );
      },

      handleShowReactionPicker: (event) => {
        event.stopPropagation();
        window.showReactionPicker?.(
          event.target,
          this.data.messageId,
          window.reactionManager,
        );
      },
    };

    // Initialize Reef component (will auto-render on data changes)
    component(this, this.template, {
      events: this.events,
      signals: [this.uuid],
    });
  }

  /**
   * Called when element is added to DOM
   * Set up reaction listener for this specific message
   */
  connectedCallback() {
    // Listen to reactions for this specific message
    const indexes = getIndexes();
    if (indexes && this.data.messageId) {
      // 正确的 API: addSliceRowIdsListener(indexId, sliceId, callback)
      // 回调签名: (indexes, indexId, sliceId) => void
      this.reactionListener = indexes.addSliceRowIdsListener(
        IndexesIds.ReactionsByMessage, // indexId
        this.data.messageId, // sliceId (the message ID)
        (indexes, indexId, sliceId) => {
          console.log(
            `🔄 Reactions changed for message: ${sliceId}`,
            'Index:',
            indexId,
          );
          // Trigger re-render by incrementing version or updating a dummy field
          this.data.version = (this.data.version || 0) + 1;
        },
      );

      console.log(
        `✅ Reaction listener added for message: ${this.data.messageId}`,
      );
    }
  }

  /**
   * Called when element is removed from DOM
   * Clean up reaction listener
   */
  disconnectedCallback() {
    const indexes = getIndexes();
    // Clean up listener when component is removed
    if (this.reactionListener && indexes) {
      indexes.delListener(this.reactionListener);
      this.reactionListener = null;
    }
  }

  /**
   * Set message data (triggers automatic re-render)
   * @param {MessageData} data - Message data object
   */
  setData(data) {
    Object.assign(this.data, data);
  }

  /**
   * Update upload progress (triggers automatic re-render)
   * @param {number} progress - Progress value (0-100)
   */
  updateProgress(progress) {
    this.data.uploadProgress = progress;
  }

  /**
   * Update upload status (triggers automatic re-render)
   * @param {string} status - Status: 'uploading', 'success', 'error'
   */
  updateStatus(status) {
    this.data.uploadStatus = status;
  }

  /**
   * UI template (returns HTML string)
   * Re-renders automatically when this.data changes
   */
  template = () => {
    const d = this.data; // Shorthand for cleaner code
    // Format timestamp for display
    const date = new Date(Number(d.timestamp));
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const hoverTime = `${hh}:${mm}`;

    // Render message content (simplified - actual implementation would handle files, etc.)
    let messageContent = d.message;
    if (d.uploadProgress !== null && d.uploadStatus === 'uploading') {
      messageContent = `Uploading... ${d.uploadProgress}%`;
    }

    // Safely encode replyTo as JSON (manually escape for attribute context)
    const replyToAttr = d.replyTo
      ? `reply-to='${String(JSON.stringify(d.replyTo)).replace(/'/g, '&#039;')}'`
      : '';

    // Build quick reactions HTML
    const quickReactionsHtml = ['like', 'love', 'laugh']
      .map((reactionId) => {
        const config = REACTION_TYPES[reactionId];
        if (!config) return '';
        return html`
          <button
            data-reaction-id="${reactionId}"
            data-message-id="${d.messageId}"
            class="${clsx('quick-reaction-btn', {
              reacted:
                window.reactionManager &&
                window.reactionManager.hasUserReacted(d.messageId, reactionId),
            })}"
            onclick="handleReaction()"
            title="${config.label}"
            style="--reaction-color: ${config.color}"
          >
            <i class="${config.icon}"></i>
          </button>
        `;
      })
      .join('');

    // Build reply/locate button HTML
    const replyButtonHtml =
      d.isInThread || d.isThreadOriginal
        ? html`
            <button
              class="message-action-btn"
              onclick="handleLocate()"
              title="Locate in main chat"
            >
              <i class="ri-map-pin-2-line"></i>
            </button>
          `
        : html`
            <button
              class="message-action-btn"
              onclick="handleReply()"
              title="Reply"
            >
              <i class="ri-chat-1-line"></i>
            </button>
          `;

    return html`
      <div
        class="message-wrapper"
        data-message-id="${d.messageId}"
        data-username="${d.name}"
        data-timestamp="${d.timestamp}"
        data-hover-time="${hoverTime}"
      >
        <!-- Message Actions (hover bar) -->
        <div class="message-actions-sticky">
          <div class="message-actions">
            <!-- Quick Reactions -->
            <div class="message-actions-section">
              ${raw(quickReactionsHtml)}
              <!-- Add "More reactions" button -->
              <button
                class="quick-reaction-btn"
                onclick="handleShowReactionPicker()"
                title="More reactions"
              >
                <i class="ri-add-circle-line"></i>
              </button>
            </div>

            <div class="message-actions-divider"></div>

            <!-- Reply / Locate Button -->
            <div class="message-actions-section">${raw(replyButtonHtml)}</div>

            <!-- More Actions -->
            <div class="message-actions-section">
              <button
                class="message-action-btn"
                onclick="handleShowMoreActions()"
                title="More actions"
              >
                <i class="ri-more-2-line"></i>
              </button>
            </div>
          </div>
        </div>

        <!-- Message Content -->
        <div class="message-content">
          <chat-message
            username="${d.name}"
            message="${messageContent}"
            timestamp="${d.timestamp}"
            message-id="${d.messageId}"
            channel="${d.channel}"
            ${attr('is-in-thread', d.isInThread)}
            ${attr('show-username', d.isFirstInGroup)}
            ${raw(
              d.uploadProgress !== null
                ? `upload-progress="${d.uploadProgress}"`
                : '',
            )}
            ${raw(d.uploadStatus ? `upload-status="${d.uploadStatus}"` : '')}
            ${raw(replyToAttr)}
            ${raw(
              d.threadInfo?.replyCount
                ? `thread-count="${d.threadInfo.replyCount}"`
                : '',
            )}
            ${raw(d.editedAt ? `edited-at="${d.editedAt}"` : '')}
          ></chat-message>
        </div>

        <!-- Reactions Display -->
        ${raw(renderReactions(d.messageId, window.reactionManager))}
      </div>
    `;
  };
}

if (!customElements.get('message-element')) {
  customElements.define('message-element', MessageElement);
}
