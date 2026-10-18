import { defineConfig } from 'playwright/test'
import config from './playwright.config'

// Explicit known-issue runner. A nonzero result remains a failure, not an
// expected-failure annotation. Promote its cases into the normal gate on repair.
export default defineConfig({
  ...config,
  testDir: './tests/known-issues',
  outputDir: './test-results/interruption',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/interruption', open: 'never' }]],
})
