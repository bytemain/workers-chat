/**
 * User State Management
 *
 * Centralized Reef.js store for user information (username)
 * Automatically syncs with localStorage for persistence
 */

import { store } from 'reefjs';
import { generateRandomUsername } from './random.mjs';

const SignalName = 'userState';

/**
 * User state
 * This replaces global variable: username, window.currentUsername
 */
export const userState = store(
  {
    // Current username
    username: null,
  },
  {
    // Action: Set username
    setUsername(state, newUsername) {
      if (newUsername && newUsername.length > 0 && newUsername.length <= 32) {
        state.username = newUsername;
        // Sync to localStorage
        localStorage.setItem('chatUsername', newUsername);
        // Update global for backward compatibility
        window.currentUsername = newUsername;
        return true;
      }
      return false;
    },

    // Action: Clear username (logout)
    clearUsername(state) {
      state.username = null;
      localStorage.removeItem('chatUsername');
      window.currentUsername = null;
    },

    // Action: Initialize from localStorage or generate random
    initUsername(state) {
      let savedUsername = localStorage.getItem('chatUsername');
      
      // If no saved username, generate a random one (but don't save yet)
      if (!savedUsername) {
        savedUsername = generateRandomUsername();
        // Don't save here - wait until user enters a room
      }
      
      state.username = savedUsername;
      window.currentUsername = savedUsername;
    },
  },
  SignalName,
);

// Initialize user state on module load
export function initUserState() {
  userState.initUsername();
  console.log('✅ User state initialized:', userState.value.username);
}

// Export helpers for backward compatibility
export function getUsername() {
  return userState.value.username;
}

export function setUsername(newUsername) {
  return userState.setUsername(newUsername);
}

export function clearUsername() {
  userState.clearUsername();
}
