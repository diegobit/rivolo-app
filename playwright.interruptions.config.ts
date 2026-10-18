import { defineConfig } from 'playwright/test'
import config from './playwright.config'

// Focused interruption subset of the ordinary browser gate. The same exact
// persistence scenarios run in `test:e2e:built` and keep retries disabled.
export default defineConfig({
  ...config,
  testDir: './tests/e2e',
  testMatch: '**/persistence-interruption.spec.ts',
  outputDir: './test-results/interruption',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/interruption', open: 'never' }]],
})
