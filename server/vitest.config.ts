import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests share one PostgreSQL test database: run files sequentially.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
