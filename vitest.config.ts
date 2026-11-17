import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

// Kept separate from vite.config.ts so the PWA plugin never runs under tests.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'convex',
          environment: 'edge-runtime',
          include: ['tests/convex/**/*.test.ts'],
          server: { deps: { inline: ['convex-test', '@convex-dev/migrations'] } },
        },
      },
      {
        plugins: [react()],
        resolve: {
          alias: { '@': path.resolve(__dirname, './src') },
        },
        test: {
          name: 'frontend',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          setupFiles: ['./tests/frontend/setup.ts'],
        },
      },
    ],
  },
})
