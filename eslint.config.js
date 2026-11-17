import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import convexPlugin from '@convex-dev/eslint-plugin'
import { defineConfig, globalIgnores } from 'eslint/config'

/** Convex recommended rules, enforced as errors for everything in convex/. */
const convexRecommendedAsError = Object.fromEntries(
  convexPlugin.configs.recommended
    .flatMap((config) => Object.entries(config.rules ?? {}))
    .map(([rule, level]) => [rule, level === 'off' ? 'off' : 'error']),
)

export default defineConfig([
  globalIgnores(['dist', 'dev-dist', 'convex/_generated']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // shadcn/ui variant exports and the ToastProvider + useToast pair are
    // intentional co-exports; fast refresh falls back to a full reload there.
    files: ['src/components/ui/**/*.tsx', 'src/components/shared/Toast.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['convex/**/*.ts'],
    plugins: { '@convex-dev': convexPlugin },
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.convex.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: convexRecommendedAsError,
  },
])
