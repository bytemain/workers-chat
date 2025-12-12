/**
 * Device detection utilities
 */

/**
 * Check if the current device is tablet (screen width from 601px to 1024px inclusive)
 * @returns {boolean}
 */
export function isTablet() {
  return window.innerWidth > 600 && window.innerWidth <= 1024;
}

/**
 * Check if the current device is desktop (screen width > 1024px)
 * @returns {boolean}
 */
export function isDesktop() {
  return window.innerWidth > 1024;
}

/**
 * Get the current device type
 * @returns {'tablet' | 'desktop'}
 */
export function getDeviceType() {
  if (isTablet()) return 'tablet';
  return 'desktop';
}
