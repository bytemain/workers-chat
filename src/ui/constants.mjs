/**
 * UI Constants for consistent layout across all panels
 */

// Header/Top bar heights
export const HEADER_HEIGHT = 48; // px - for channel-info-bar, titlebar
export const FOOTER_HEIGHT = 60; // px - for user-info-card, channel-add
export const MOBILE_TOP_BAR_HEIGHT = 60; // px - mobile top navigation

// Sidebar widths
export const LEFT_SIDEBAR_WIDTH = 72; // px
export const CHANNEL_PANEL_WIDTH = 180; // px
export const RIGHT_SIDEBAR_WIDTH = 200; // px
export const THREAD_PANEL_WIDTH = 400; // px

// Element heights
export const USER_CARD_HEIGHT = 72; // px - user info card at bottom
export const AVATAR_SIZE = 36; // px - standard avatar size in messages
export const USER_AVATAR_SIZE = 40; // px - user card avatar size

// Spacing (matches CSS variables)
export const SPACING = 16; // px - var(--spacing)
export const SPACING_SM = 8; // px - var(--spacing-sm)
export const SPACING_XS = 4; // px - var(--spacing-xs)

// Border radius
export const BORDER_RADIUS = 5; // px

// Apply constants to CSS
export function applyCSSConstants() {
  const root = document.documentElement;
  root.style.setProperty('--header-height', `${HEADER_HEIGHT}px`);
  root.style.setProperty('--footer-height', `${FOOTER_HEIGHT}px`);
  root.style.setProperty(
    '--mobile-top-bar-height',
    `${MOBILE_TOP_BAR_HEIGHT}px`,
  );
  root.style.setProperty('--left-sidebar-width', `${LEFT_SIDEBAR_WIDTH}px`);
  root.style.setProperty('--user-card-height', `${USER_CARD_HEIGHT}px`);
}
