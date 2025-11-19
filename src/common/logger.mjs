/**
 * Logger utility - conditionally logs based on environment
 *
 * In production:
 * - log() and debug() are disabled
 * - warn() and error() are always enabled
 *
 * In development (localhost):
 * - All log levels are enabled
 */

const isDev =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.startsWith('192.168.') ||
    window.location.hostname.endsWith('.local'));

/**
 * Logger instance
 */
export const logger = {
  /**
   * Debug log - only in development
   * Use for verbose debugging information
   */
  debug: (...args) => {
    if (isDev) {
      console.debug(...args);
    }
  },

  /**
   * Info log - only in development
   * Use for general information
   */
  log: (...args) => {
    if (isDev) {
      console.log(...args);
    }
  },

  /**
   * Warning log - always enabled
   * Use for recoverable issues
   */
  warn: (...args) => {
    console.warn(...args);
  },

  /**
   * Error log - always enabled
   * Use for errors that need attention
   */
  error: (...args) => {
    console.error(...args);
  },

  /**
   * Check if running in development mode
   */
  isDev: () => isDev,
};

// Export as default for convenience
export default logger;
