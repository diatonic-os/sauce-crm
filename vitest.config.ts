import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    alias: {
      obsidian: './test/_stubs/obsidian.ts',
    },
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
