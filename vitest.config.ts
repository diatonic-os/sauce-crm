import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    pool: 'forks',
    singleFork: true,
    alias: [
      // Absolute path so deep imports (src/copilot/CopilotHostAdapters.ts
      // importing from "obsidian") resolve correctly under vite's loader.
      { find: 'obsidian', replacement: resolve(__dirname, 'test/_stubs/obsidian.ts') },
      // Honor the tsconfig `@/*` -> `src/*` path alias (tsc + esbuild resolve it
      // natively; vite/vitest does not read tsconfig paths). Regex anchored to
      // `@/` so it never matches scoped packages like `@lancedb/lancedb`.
      { find: /^@\//, replacement: resolve(__dirname, 'src') + '/' },
    ],
    // singleFork (set above): the @lancedb/lancedb native addon panics when
    // multiple vitest worker processes load/tear it down concurrently.
    include: ['test/**/*.test.ts', 'src/**/*.test.ts', 'sdk/**/*.test.ts'],
  },
});
