/**
 * Reaction Types Configuration
 * English-first labels
 */

export const REACTION_TYPES = {
  like: {
    id: 'like',
    icon: 'ri-thumb-up-line',
    iconFilled: 'ri-thumb-up-fill',
    label: 'Like',
    color: '#3b82f6', // blue
  },
  love: {
    id: 'love',
    icon: 'ri-heart-line',
    iconFilled: 'ri-heart-fill',
    label: 'Love',
    color: '#ef4444', // red
  },
  laugh: {
    id: 'laugh',
    icon: 'ri-emotion-laugh-line',
    iconFilled: 'ri-emotion-laugh-fill',
    label: 'Haha',
    color: '#f59e0b', // orange
  },
  wow: {
    id: 'wow',
    icon: 'ri-emotion-2-line',
    iconFilled: 'ri-emotion-2-fill',
    label: 'Wow',
    color: '#8b5cf6', // purple
  },
  sad: {
    id: 'sad',
    icon: 'ri-emotion-sad-line',
    iconFilled: 'ri-emotion-sad-fill',
    label: 'Sad',
    color: '#6b7280', // gray
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
export const REACTION_ORDER = ['like', 'love', 'laugh', 'wow', 'sad', 'check'];
