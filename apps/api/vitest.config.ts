import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://erp_app:erp_app_dev@localhost:5432/erp_test',
      MIGRATION_DATABASE_URL: process.env.TEST_MIGRATION_DATABASE_URL ?? 'postgres://erp_owner:erp_owner_dev@localhost:5432/erp_test',
      JWT_SECRET: 'test-secret',
      RECURRING_SCHEDULER: 'off',
      RATE_LIMIT: 'off',
      STORAGE_DIR: './storage-test',
    },
  },
});
