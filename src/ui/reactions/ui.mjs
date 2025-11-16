/**
 * Reaction UI Components
 * Renders reaction buttons, picker, and handles events
 */

import { REACTION_TYPES, REACTION_ORDER } from './config.mjs';

/**
 * Render reactions for a message
 * @param {string} messageId - Message ID
 * @param {ReactionManager} reactionManager - Reaction manager instance
 * @returns {string} - HTML string for reactions
 */
export function renderReactions(messageId, reactionManager) {
  const reactions = reactionManager.getReactions(messageId);

  if (reactions.length === 0) {
    return `<div class="message-reactions" data-message-id="${messageId}"></div>`;
  }

  console.log(`🎨 renderReactions for ${messageId}:`, reactions);
  return `
    <div class="message-reactions" data-message-id="${messageId}">
      ${reactions
        .map((r) => {
          const config = r.config;
          const icon = r.userReacted ? config.iconFilled : config.icon;

          return `
          <button 
            class="reaction-btn ${r.userReacted ? 'reacted' : ''}"
            data-message-id="${messageId}"
            data-reaction-id="${r.reactionId}"
            title="${r.users.join(', ')}"
            style="--reaction-color: ${config.color}"
          >
            <i class="${icon}"></i>
            <span class="reaction-count">${r.count}</span>
          </button>
        `;
        })
        .join('')}
      
      <button 
        class="reaction-add-btn"
        data-message-id="${messageId}"
        title="Add reaction"
      >
        <i class="ri-add-line"></i>
      </button>
    </div>
  `;
}

/**
 * Create and show reaction picker
 * @param {HTMLElement} triggerElement - Element that triggered the picker
 * @param {string} messageId - Message ID
 * @param {ReactionManager} reactionManager - Reaction manager instance
 */
export function showReactionPicker(triggerElement, messageId, reactionManager) {
  // Remove existing pickers
  document.querySelectorAll('.reaction-picker').forEach((el) => el.remove());

  // Create picker
  const picker = document.createElement('div');
  picker.className = 'reaction-picker';
  picker.dataset.messageId = messageId;

  // Add reaction options
  REACTION_ORDER.forEach((id) => {
    const type = REACTION_TYPES[id];
    const btn = document.createElement('button');
    btn.className = 'reaction-picker-item';
    btn.dataset.reactionId = type.id;
    btn.title = type.label;
    btn.style.setProperty('--reaction-color', type.color);
    btn.innerHTML = `<i class="${type.icon}"></i>`;
    picker.appendChild(btn);
  });

  // Position picker
  document.body.appendChild(picker);
  const rect = triggerElement.getBoundingClientRect();
  picker.style.position = 'absolute';
  picker.style.left = `${rect.left}px`;
  picker.style.top = `${rect.bottom + 4}px`;

  // Adjust if off-screen
  const pickerRect = picker.getBoundingClientRect();
  if (pickerRect.right > window.innerWidth) {
    picker.style.left = `${window.innerWidth - pickerRect.width - 8}px`;
  }
  if (pickerRect.bottom > window.innerHeight) {
    picker.style.top = `${rect.top - pickerRect.height - 4}px`;
  }

  // Click reaction option
  picker.addEventListener('click', (e) => {
    const btn = e.target.closest('.reaction-picker-item');
    if (btn) {
      const reactionId = btn.dataset.reactionId;
      reactionManager.addReaction(messageId, reactionId);
      picker.remove();
    }
  });

  // Click outside to close
  setTimeout(() => {
    function closePickerOnClickOutside(e) {
      if (!picker.contains(e.target) && e.target !== triggerElement) {
        picker.remove();
        document.removeEventListener('click', closePickerOnClickOutside);
      }
    }
    document.addEventListener('click', closePickerOnClickOutside);
  }, 0);

  // Escape key to close
  function closePickerOnEscape(e) {
    if (e.key === 'Escape') {
      picker.remove();
      document.removeEventListener('keydown', closePickerOnEscape);
    }
  }
  document.addEventListener('keydown', closePickerOnEscape);
}

/**
 * Initialize reaction event listeners
 * @param {string} containerSelector - CSS selector for message container
 * @param {ReactionManager} reactionManager - Reaction manager instance
 */
export function initReactionEvents(containerSelector, reactionManager) {
  const container = document.querySelector(containerSelector);
  if (!container) {
    console.error('Reaction container not found:', containerSelector);
    return;
  }

  // Event delegation for reaction buttons
  container.addEventListener('click', (e) => {
    // Toggle existing reaction
    const reactionBtn = e.target.closest('.reaction-btn');
    if (reactionBtn) {
      e.preventDefault();
      e.stopPropagation();
      const messageId = reactionBtn.dataset.messageId;
      const reactionId = reactionBtn.dataset.reactionId;
      reactionManager.toggleReaction(messageId, reactionId);
      return;
    }

    // Show reaction picker
    const addBtn = e.target.closest('.reaction-add-btn');
    if (addBtn) {
      e.preventDefault();
      e.stopPropagation();
      const messageId = addBtn.dataset.messageId;
      showReactionPicker(addBtn, messageId, reactionManager);
      return;
    }
  });

  console.log('✅ Reaction events initialized');
}
