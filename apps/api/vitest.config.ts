import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Only run TypeScript source tests, never compiled output or git worktrees
    include: ['src/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/.worktrees/**',
      '**/.orc/**',
      '**/dist/**',
    ],
  },
})
