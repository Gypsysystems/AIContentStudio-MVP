import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/generate-topic-jobs-api.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
})