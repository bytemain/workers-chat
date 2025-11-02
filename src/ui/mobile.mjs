/**
 * Mobile UI Module
 * Handles all mobile-specific UI interactions and navigation
 */

import { isMobile } from './utils/device.mjs';

// Mobile state
let currentMobilePage = null;

/**
 * Show mobile channel list page
 */
export function showMobileChannelList() {
  const channelListPage = document.getElementById('mobile-channel-list-page');
  const chatPage = document.getElementById('mobile-chat-page');

  if (channelListPage) {
    channelListPage.classList.add('active');
    currentMobilePage = 'channels';
  }
  if (chatPage) {
    chatPage.classList.remove('active');
  }
}

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
 * Update mobile channel list content
 * @param {Array} channels - Array of channel objects
 * @param {string} currentChannel - Currently active channel
 * @param {Function} switchToChannel - Function to switch to a channel
 * @param {string} username - Current username for DMs
 */
export function updateMobileChannelList(
  channels,
  currentChannel,
  switchToChannel,
  username,
) {
  const mobileChannelListContent = document.getElementById(
    'mobile-channel-list-content',
  );
  if (!mobileChannelListContent) return;

  // Create channels section
  const channelsSection = document.createElement('div');
  channelsSection.className = 'mobile-channel-section';
  channelsSection.innerHTML = `
    <div class="mobile-channel-section-title">Channels</div>
  `;

  const channelsContainer = document.createElement('div');
  channelsContainer.className = 'mobile-channel-section-items';

  channels.forEach((channel) => {
    if (channel.name.startsWith('dm-')) return; // Skip DMs in channel section

    const channelItem = document.createElement('div');
    channelItem.className = 'mobile-channel-item';
    if (channel.name === currentChannel) {
      channelItem.classList.add('active');
    }

    const unreadCount = window.getUnreadCount?.(channel.name) || 0;

    channelItem.innerHTML = `
      <div class="mobile-channel-item-icon">
        <i class="ri-hashtag"></i>
      </div>
      <div class="mobile-channel-item-info">
        <div class="mobile-channel-item-name">${channel.name}</div>
        <div class="mobile-channel-item-count">${channel.messageCount || 0} messages</div>
      </div>
      ${
        unreadCount > 0
          ? `<div class="mobile-channel-item-badge">${unreadCount}</div>`
          : ''
      }
      <div class="mobile-channel-item-arrow">
        <i class="ri-arrow-right-s-line"></i>
      </div>
    `;

    channelItem.onclick = () => {
      switchToChannel(channel.name);
      showMobileChatPage();
    };

    channelsContainer.appendChild(channelItem);
  });

  channelsSection.appendChild(channelsContainer);
  mobileChannelListContent.innerHTML = '';
  mobileChannelListContent.appendChild(channelsSection);

  // Create DMs section
  const dmsSection = document.createElement('div');
  dmsSection.className = 'mobile-channel-section';
  dmsSection.innerHTML = `
    <div class="mobile-channel-section-title">Direct Messages</div>
  `;

  const dmsContainer = document.createElement('div');
  dmsContainer.className = 'mobile-channel-section-items';

  // Add self DM
  if (username) {
    const selfDM = document.createElement('div');
    selfDM.className = 'mobile-channel-item';
    const selfChannelName = `dm-${username}`;
    if (selfChannelName === currentChannel) {
      selfDM.classList.add('active');
    }

    selfDM.innerHTML = `
      <div class="mobile-channel-item-icon">
        <i class="ri-user-line"></i>
      </div>
      <div class="mobile-channel-item-info">
        <div class="mobile-channel-item-name">${username} (You)</div>
        <div class="mobile-channel-item-count">Personal space</div>
      </div>
      <div class="mobile-channel-item-arrow">
        <i class="ri-arrow-right-s-line"></i>
      </div>
    `;

    selfDM.onclick = () => {
      switchToChannel(selfChannelName);
      showMobileChatPage();
    };

    dmsContainer.appendChild(selfDM);
  }

  dmsSection.appendChild(dmsContainer);
  mobileChannelListContent.appendChild(dmsSection);
}

/**
 * Update mobile top bar title
 * @param {string} title - Title to display
 */
export function updateMobileTopBarTitle(title) {
  const mobileTopBarTitle = document.querySelector('#mobile-top-bar-title');
  if (mobileTopBarTitle) {
    mobileTopBarTitle.textContent = title;
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
 * @param {Function} loadHashtags - Function to load hashtags
 */
export function initMobileNavigation(loadHashtags) {
  // Mobile nav bar buttons
  const navChannelsBtn = document.getElementById('nav-channels-btn');
  const navChatBtn = document.getElementById('nav-chat-btn');

  if (navChannelsBtn) {
    navChannelsBtn.addEventListener('click', () => {
      showMobileChannelList();
    });
  }

  if (navChatBtn) {
    navChatBtn.addEventListener('click', () => {
      showMobileChatPage();
    });
  }

  // Initialize on chat page by default (if in a room)
  if (window.location.hash.length > 1) {
    showMobileChatPage();
  } else {
    showMobileChannelList();
  }
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
  // Detect mobile keyboard appearing and disappearing, and adjust the scroll as appropriate.
  if ('visualViewport' in window) {
    window.visualViewport.addEventListener('resize', function (event) {
      if (isAtBottom()) {
        chatlog.scrollBy(0, 1e8);
      }
    });
  }
}

/**
 * Get current mobile page
 * @returns {string|null} Current page name ('channels' or 'chat')
 */
export function getCurrentMobilePage() {
  return currentMobilePage;
}

/**
 * Check if device is mobile
 * @returns {boolean}
 */
export function checkIsMobile() {
  return isMobile();
}

// Export all functions as window globals for backward compatibility
if (typeof window !== 'undefined') {
  window.showMobileChannelList = showMobileChannelList;
  window.showMobileChatPage = showMobileChatPage;
  window.updateMobileChannelList = updateMobileChannelList;
  window.initMobileNavigation = initMobileNavigation;
  window.initMobileRoomSelector = initMobileRoomSelector;
  window.updateMobileTopBarTitle = updateMobileTopBarTitle;
  window.updateMobileEncryptionIndicator = updateMobileEncryptionIndicator;
  window.toggleMobileRoomInfo = toggleMobileRoomInfo;
  window.closeMobileRoomInfo = closeMobileRoomInfo;
  window.handleMobileThreadPanel = handleMobileThreadPanel;
  window.setupMobileKeyboardHandler = setupMobileKeyboardHandler;
}
