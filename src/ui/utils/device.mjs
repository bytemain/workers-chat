/**
 * Device detection utilities
 */

/**
 * Check if the current device is mobile (screen width <= 600px)
 * @returns {boolean}
 */
export function isMobile() {
  return window.innerWidth <= 600;
}

/**
 * Check if the current device is tablet (screen width between 601px and 1024px)
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
 * @returns {'mobile' | 'tablet' | 'desktop'}
 */
export function getDeviceType() {
  if (isMobile()) return 'mobile';
  if (isTablet()) return 'tablet';
  return 'desktop';
}
