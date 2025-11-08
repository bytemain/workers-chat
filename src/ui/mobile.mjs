/**
 * Mobile UI Module
 * Handles all mobile-specific UI interactions and navigation
 */

import { isMobile } from './utils/device.mjs';
import { initChannelInfo, openChannelInfo } from './mobile/channel-info.mjs';

// Mobile state
let currentMobilePage = null;

/**
 * Show mobile chat page
 */
export function showMobileChatPage() {
  const channelListPage = document.getElementById('mobile-channel-list-page');
  const chatPage = document.getElementById('mobile-chat-page');

  if (chatPage) {
    chatPage.classList.add('active');
    currentMobilePage = 'chat';
  }
  if (channelListPage) {
    channelListPage.classList.remove('active');
  }
}

/**
 * Update mobile encryption indicator
 * @param {boolean} hasValidKey - Whether encryption is active
 */
export function updateMobileEncryptionIndicator(hasValidKey) {
  const mobileTopBarEncryption = document.querySelector(
    '#mobile-top-bar-encryption',
  );

  if (mobileTopBarEncryption) {
    mobileTopBarEncryption.classList.add('visible');
    if (hasValidKey) {
      mobileTopBarEncryption.textContent = '🔒';
      mobileTopBarEncryption.className = 'visible encrypted';
      mobileTopBarEncryption.title = 'End-to-End Encrypted';
    } else {
      mobileTopBarEncryption.textContent = '🔓';
      mobileTopBarEncryption.className = 'visible not-encrypted';
      mobileTopBarEncryption.title = 'Not Encrypted';
    }
  }
}

/**
 * Toggle mobile room info overlay
 * @param {HTMLElement} rightSidebar - Right sidebar element
 * @param {HTMLElement} mobileRoomInfoOverlay - Overlay element
 * @param {HTMLElement} mobileTopBarArrow - Arrow indicator element
 */
export function toggleMobileRoomInfo(
  rightSidebar,
  mobileRoomInfoOverlay,
  mobileTopBarArrow,
) {
  if (!rightSidebar) return;

  const isOpen = rightSidebar.classList.contains('mobile-visible');
  if (isOpen) {
    rightSidebar.classList.remove('mobile-visible');
    if (mobileRoomInfoOverlay) {
      mobileRoomInfoOverlay.classList.remove('visible');
    }
    if (mobileTopBarArrow) {
      mobileTopBarArrow.classList.remove('open');
    }
  } else {
    rightSidebar.classList.add('mobile-visible');
    if (mobileRoomInfoOverlay) {
      mobileRoomInfoOverlay.classList.add('visible');
    }
    if (mobileTopBarArrow) {
      mobileTopBarArrow.classList.add('open');
    }
  }
}

/**
 * Close mobile room info overlay
 * @param {HTMLElement} rightSidebar - Right sidebar element
 * @param {HTMLElement} mobileRoomInfoOverlay - Overlay element
 * @param {HTMLElement} mobileTopBarArrow - Arrow indicator element
 */
export function closeMobileRoomInfo(
  rightSidebar,
  mobileRoomInfoOverlay,
  mobileTopBarArrow,
) {
  if (rightSidebar) {
    rightSidebar.classList.remove('mobile-visible');
  }
  if (mobileRoomInfoOverlay) {
    mobileRoomInfoOverlay.classList.remove('visible');
  }
  if (mobileTopBarArrow) {
    mobileTopBarArrow.classList.remove('open');
  }
}

/**
 * Handle mobile thread panel visibility
 * @param {boolean} isOpen - Whether thread panel should be open
 */
export function handleMobileThreadPanel(isOpen) {
  const mainInputContainer = document.getElementById(
    'main-chat-input-container',
  );

  if (!mainInputContainer) return;

  if (isOpen) {
    mainInputContainer.classList.add('thread-open');

    // Prevent body scroll on mobile when thread is open
    if (window.innerWidth <= 600) {
      document.body.classList.add('thread-open');
    }
  } else {
    mainInputContainer.classList.remove('thread-open');
    document.body.classList.remove('thread-open');
  }
}

/**
 * Initialize mobile navigation system
 */
export function initMobileNavigation() {
  // Initialize mobile channel-info component (mounts its container to body)
  try {
    initChannelInfo('body');
    setupMobileChatTitleButton();
  } catch (e) {
    // Fail silently if component can't initialize in current environment
    console.warn('initChannelInfo failed:', e);
  }
}

/**
 * Setup channel info button next to mobile chat title
 */
function setupMobileChatTitleButton() {
  const mobileChatTitle = document.getElementById('mobile-chat-title');
  if (!mobileChatTitle) return;

  // Check if button already exists
  let channelInfoBtn = document.getElementById('mobile-channel-info-btn');
  if (channelInfoBtn) return;

  // Create button
  channelInfoBtn = document.createElement('button');
  channelInfoBtn.id = 'mobile-channel-info-btn';
  channelInfoBtn.className = 'mobile-channel-info-btn';
  channelInfoBtn.type = 'button';
  channelInfoBtn.title = 'Channel info';
  channelInfoBtn.innerHTML = '<i class="ri-arrow-right-s-line"></i>';

  // Insert after chat title
  if (mobileChatTitle.parentNode) {
    mobileChatTitle.parentNode.insertBefore(
      channelInfoBtn,
      mobileChatTitle.nextSibling,
    );
  }

  // Click opens channel info
  channelInfoBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const room = window.currentRoomName || '';
    const channel = window.currentChannel || '';
    if (room && channel) {
      openChannelInfo(room, channel);
    }
  });
}

/**
 * Initialize mobile room selector
 * @param {string} roomname - Current room name
 * @param {Function} populateDropdown - Function to populate room dropdown
 */
export function initMobileRoomSelector(roomname, populateDropdown) {
  const mobileRoomHeader = document.getElementById('mobile-room-header');
  const mobileRoomNameDisplay = document.getElementById(
    'mobile-room-name-display',
  );
  const mobileRoomDropdown = document.getElementById('mobile-room-dropdown');
  const mobileRoomMenuBtn = document.getElementById('mobile-room-menu-btn');

  if (!mobileRoomHeader || !mobileRoomNameDisplay || !mobileRoomDropdown)
    return;

  // Update room name display
  const updateMobileRoomName = () => {
    if (roomname) {
      mobileRoomNameDisplay.textContent = roomname;
    } else {
      mobileRoomNameDisplay.textContent = 'Select a Room';
    }
  };
  updateMobileRoomName();

  // Toggle dropdown on header click
  mobileRoomHeader.addEventListener('click', (e) => {
    // Don't toggle if clicking the menu button
    if (e.target.closest('#mobile-room-menu-btn')) return;

    const isOpen = mobileRoomDropdown.classList.contains('visible');
    if (isOpen) {
      mobileRoomDropdown.classList.remove('visible');
      mobileRoomHeader.classList.remove('dropdown-open');
    } else {
      mobileRoomDropdown.classList.add('visible');
      mobileRoomHeader.classList.add('dropdown-open');
      // Populate dropdown using room-list component
      populateDropdown();
    }
  });

  // Menu button - show room menu
  if (mobileRoomMenuBtn) {
    mobileRoomMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Reuse existing room menu functionality
      const roomMenuBtn = document.getElementById('room-menu-btn');
      if (roomMenuBtn) {
        roomMenuBtn.click();
      }
    });
  }

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (
      !mobileRoomHeader.contains(e.target) &&
      !mobileRoomDropdown.contains(e.target)
    ) {
      mobileRoomDropdown.classList.remove('visible');
      mobileRoomHeader.classList.remove('dropdown-open');
    }
  });

  return updateMobileRoomName;
}

/**
 * Handle mobile keyboard resize (visual viewport)
 * @param {HTMLElement} chatlog - Chatlog element
 * @param {Function} isAtBottom - Function to check if at bottom
 */
export function setupMobileKeyboardHandler(chatlog, isAtBottom) {
  if (!isMobile()) return;

  const inputContainer = document.getElementById('main-chat-input-container');
  const threadInputContainer = document.getElementById(
    'thread-input-container',
  );

  let lastViewportHeight = window.visualViewport?.height || window.innerHeight;

  // Function to update input container position based on visual viewport
  function updateInputPosition() {
    if (!window.visualViewport) return;

    const viewport = window.visualViewport;
    const currentHeight = viewport.height;
    const offsetY = window.innerHeight - currentHeight;

    // Only apply transform if keyboard is actually showing (significant height change)
    if (offsetY > 50) {
      // Keyboard is showing
      if (inputContainer) {
        inputContainer.style.transform = `translateY(-${offsetY}px)`;
      }

      if (threadInputContainer) {
        threadInputContainer.style.transform = `translateY(-${offsetY}px)`;
      }

      // Ensure chat scrolls to bottom if user was at bottom
      if (isAtBottom()) {
        requestAnimationFrame(() => {
          chatlog.scrollBy(0, 1e8);
        });
      }
    } else {
      // Keyboard is hidden, reset position
      if (inputContainer) {
        inputContainer.style.transform = 'translateY(0)';
      }

      if (threadInputContainer) {
        threadInputContainer.style.transform = 'translateY(0)';
      }
    }

    lastViewportHeight = currentHeight;
  }

  // Detect mobile keyboard appearing and disappearing
  if ('visualViewport' in window) {
    window.visualViewport.addEventListener('resize', updateInputPosition);
    window.visualViewport.addEventListener('scroll', updateInputPosition);

    // Initial position update
    updateInputPosition();
  }

  // Focus handling - ensure input scrolls into view
  const setupInputFocusHandler = (input) => {
    if (!input) return;

    input.addEventListener('focus', () => {
      // Small delay to allow keyboard animation to start
      setTimeout(() => {
        // Force update position
        updateInputPosition();

        // Scroll input into view
        input.scrollIntoView({
          behavior: 'smooth',
          block: 'end',
          inline: 'nearest',
        });

        // Ensure chatlog stays at bottom if needed
        setTimeout(() => {
          if (isAtBottom()) {
            chatlog.scrollBy(0, 1e8);
          }
        }, 150);
      }, 100);
    });

    input.addEventListener('blur', () => {
      // Reset position when losing focus (keyboard might close)
      setTimeout(updateInputPosition, 100);
    });
  };

  // Setup focus handlers for text inputs (use setTimeout to ensure elements exist)
  setTimeout(() => {
    const mainInput = document.querySelector('#chat-input textarea');
    const threadInput = document.querySelector('#thread-input textarea');

    setupInputFocusHandler(mainInput);
    setupInputFocusHandler(threadInput);
  }, 500);
}

// Export all functions as window globals for backward compatibility
if (typeof window !== 'undefined') {
  window.initMobileRoomSelector = initMobileRoomSelector;
  window.toggleMobileRoomInfo = toggleMobileRoomInfo;
  window.closeMobileRoomInfo = closeMobileRoomInfo;
  window.handleMobileThreadPanel = handleMobileThreadPanel;
  window.setupMobileKeyboardHandler = setupMobileKeyboardHandler;
}
