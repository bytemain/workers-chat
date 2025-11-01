/**
 * Room List Component
 * Manages the room dropdown in the channel panel header
 */

/**
 * Create and render room list dropdown
 * @param {Array} rooms - Array of room objects with {name, unreadCount}
 * @param {string} currentRoom - Name of the current room
 * @param {Function} onRoomClick - Callback when room is clicked
 * @param {Function} onCreateRoom - Callback when create room is clicked
 * @param {Function} onRoomContextMenu - Callback for right-click context menu
 * @returns {HTMLElement} The room list container element
 */
export function createRoomList(
  rooms,
  currentRoom,
  onRoomClick,
  onCreateRoom,
  onRoomContextMenu,
) {
  const container = document.createElement('div');
  container.className = 'room-list-container';

  // Add isolated styles
  const style = document.createElement('style');
  style.textContent = /** css */ `
    .room-list-container {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 4px;
    }

    .room-list-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border-radius: 4px;
      cursor: pointer;
      transition: background-color 0.15s ease;
      position: relative;
      min-height: 32px;
    }

    .room-list-item:hover {
      background-color: var(--background-alt);
    }

    .room-list-item.current {
      background-color: var(--background-alt);
      font-weight: 600;
    }

    .room-list-item.current::before {
      content: '';
      position: absolute;
      left: 0;
      top: 50%;
      transform: translateY(-50%);
      width: 3px;
      height: 60%;
      background: var(--links);
      border-radius: 0 2px 2px 0;
    }

    .room-list-icon {
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      color: var(--text-muted);
      flex-shrink: 0;
    }

    .room-list-item.current .room-list-icon {
      color: var(--text-main);
    }

    .room-list-icon i {
      font-size: 16px;
    }

    .room-list-content {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .room-list-name {
      font-size: 14px;
      color: var(--text-main);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }

    .room-list-unread {
      font-size: 12px;
      font-weight: 600;
      color: #dc3545;
      flex-shrink: 0;
    }

    .room-list-separator {
      height: 1px;
      background: var(--border);
      margin: 4px 0;
    }

    .room-list-create {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      border-radius: 4px;
      cursor: pointer;
      transition: background-color 0.15s ease, color 0.15s ease;
      color: var(--text-muted);
      font-weight: 500;
      font-size: 14px;
      border: none;
      background: transparent;
      width: 100%;
      text-align: left;
      font-family: inherit;
    }

    .room-list-create:hover {
      background-color: var(--background-alt);
      color: var(--text-main);
    }

    .room-list-create i {
      font-size: 16px;
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .room-list-empty {
      padding: 16px 8px;
      text-align: center;
      color: var(--text-muted);
      font-size: 13px;
    }
  `;

  if (!document.querySelector('style[data-room-list-styles]')) {
    style.setAttribute('data-room-list-styles', 'true');
    document.head.appendChild(style);
  }

  // Render room items
  if (rooms.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'room-list-empty';
    empty.textContent = 'No rooms yet';
    container.appendChild(empty);
  } else {
    rooms.forEach((room) => {
      const item = document.createElement('div');
      item.className = 'room-list-item';
      item.dataset.roomName = room.name;

      if (room.name === currentRoom) {
        item.classList.add('current');
      }

      // Icon
      const icon = document.createElement('span');
      icon.className = 'room-list-icon';
      icon.innerHTML = room.isPrivate
        ? '<i class="ri-lock-line"></i>'
        : '<i class="ri-hashtag"></i>';
      item.appendChild(icon);

      // Content (name + unread)
      const content = document.createElement('div');
      content.className = 'room-list-content';

      const name = document.createElement('span');
      name.className = 'room-list-name';
      name.textContent = room.displayName;
      content.appendChild(name);

      if (room.unreadCount > 0) {
        const unread = document.createElement('span');
        unread.className = 'room-list-unread';
        unread.textContent = room.unreadCount > 99 ? '99+' : room.unreadCount;
        content.appendChild(unread);
      }

      item.appendChild(content);

      // Click handler
      item.addEventListener('click', () => {
        onRoomClick(room.name);
      });

      // Context menu handler
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        onRoomContextMenu(e, room.name);
      });

      container.appendChild(item);
    });
  }

  // Separator
  const separator = document.createElement('div');
  separator.className = 'room-list-separator';
  container.appendChild(separator);

  // Create room button
  const createBtn = document.createElement('button');
  createBtn.className = 'room-list-create';
  createBtn.innerHTML = '<i class="ri-add-line"></i><span>Create Room</span>';
  createBtn.addEventListener('click', onCreateRoom);
  container.appendChild(createBtn);

  return container;
}

/**
 * Update room list in the dropdown
 * @param {HTMLElement} dropdown - The dropdown container element
 * @param {Array} rooms - Array of room objects
 * @param {string} currentRoom - Name of the current room
 * @param {Object} callbacks - Object with callback functions
 */
export function updateRoomList(dropdown, rooms, currentRoom, callbacks) {
  if (!dropdown) return;

  // Clear existing content
  dropdown.innerHTML = '';

  // Create and append new room list
  const roomList = createRoomList(
    rooms,
    currentRoom,
    callbacks.onRoomClick,
    callbacks.onCreateRoom,
    callbacks.onRoomContextMenu,
  );

  dropdown.appendChild(roomList);
}
