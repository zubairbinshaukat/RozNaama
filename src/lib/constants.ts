/** Available themes */
export const THEMES = ['light', 'dark', 'midnight', 'ocean', 'forest', 'rose', 'sunset'] as const
export type Theme = (typeof THEMES)[number]

/** Stored preference: a concrete theme, or random (new roll on each full page load) */
export type ThemePreference = Theme | 'random'

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

/**
 * Shared with the Convex backend (single source of truth):
 * category color swatches, max items per Add Sale modal, and text/amount limits.
 */
export {
  CATEGORY_COLORS,
  MAX_SALE_ITEMS,
  PRODUCT_NAME_MAX,
  NOTE_MAX,
  CATEGORY_NAME_MAX,
  AMOUNT_MAX,
} from '../../convex/lib/limits'
export type { CategoryColor } from '../../convex/lib/limits'

/** Toast auto-dismiss delay (ms) */
export const TOAST_DURATION = 4000
