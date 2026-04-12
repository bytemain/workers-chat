/**
 * Reaction Types Configuration
 * Simplified to 3 essential reactions for clarity
 */

export const REACTION_TYPES = {
  like: {
    id: 'like',
    icon: 'ri-thumb-up-line',
    iconFilled: 'ri-thumb-up-fill',
    label: 'Like',
    color: '#3b82f6', // blue
  },
  laugh: {
    id: 'laugh',
    icon: 'ri-emotion-laugh-line',
    iconFilled: 'ri-emotion-laugh-fill',
    label: 'Haha',
    color: '#f59e0b', // orange
  },
  check: {
    id: 'check',
    icon: 'ri-check-line',
    iconFilled: 'ri-check-fill',
    label: 'Done',
    color: '#10b981', // green
  },
};

// Ordered list for consistent display
export const REACTION_ORDER = ['like', 'laugh', 'check'];
