import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      exclude: ['scripts/**', 'commitlint.config.js', 'eslint.config.mjs', 'api.js'],
    },
  },
});
