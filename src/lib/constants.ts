/** Available themes */
export const THEMES = ['light', 'dark', 'midnight', 'ocean', 'forest', 'rose', 'sunset'] as const
export type Theme = (typeof THEMES)[number]

export const THEME_LABELS: Record<Theme, string> = {
  light:    'Light',
  dark:     'Dark',
  midnight: 'Midnight',
  ocean:    'Ocean',
  forest:   'Forest',
  rose:     'Rose',
  sunset:   'Sunset',
}

/** Accent color shown in the theme picker swatches */
export const THEME_ACCENT_COLORS: Record<Theme, string> = {
  light:    '#6366f1',
  dark:     '#6366f1',
  midnight: '#f59e0b',
  ocean:    '#06b6d4',
  forest:   '#22c55e',
  rose:     '#f43f5e',
  sunset:   '#f97316',
}

/** Whether the theme uses a dark background */
export const THEME_IS_DARK: Record<Theme, boolean> = {
  light:    false,
  dark:     true,
  midnight: true,
  ocean:    true,
  forest:   true,
  rose:     true,
  sunset:   true,
}

/** Color swatches for the Add Category modal */
export const CATEGORY_COLORS = [
  '#6366F1',  // indigo
  '#8B5CF6',  // violet
  '#EC4899',  // pink
  '#EF4444',  // red
  '#F97316',  // orange
  '#EAB308',  // yellow
  '#22C55E',  // green
  '#06B6D4',  // cyan
] as const

export type CategoryColor = (typeof CATEGORY_COLORS)[number]

/** Toast auto-dismiss delay (ms) */
export const TOAST_DURATION = 4000

/** Max items per Add Sale modal */
export const MAX_SALE_ITEMS = 20
