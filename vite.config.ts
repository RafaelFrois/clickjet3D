import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works from any sub-path (GitHub Pages, itch.io, etc.).
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
  },
  server: { host: true },
  preview: { host: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
