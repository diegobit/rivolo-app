import { test, expect, type Page } from 'playwright/test'

const note = (page: Page) => page.locator('.cm-content[contenteditable="true"]').first()
async function start(page: Page, origin: string) {
  await page.goto(origin)
  await page.getByRole('button', { name: 'Start Today' }).click()
  await expect(note(page)).toBeVisible()
}
async function settings(page: Page) {
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible()
}

// Playwright WebKit offline emulation currently rejects even literal SW
// responses: https://github.com/microsoft/playwright/issues/42775.
// Do not report this as Safari/PWA proof. This file is Chromium-only.
test('J1 offline: generated service worker reopens the app and persists local edits', async ({ page, context }, testInfo) => {
  const configured = new URL(String(testInfo.project.use.baseURL))
  const origin = `http://127.0.0.1:${Number(configured.port) + 2}`
  await start(page, origin)
  await note(page).fill('Offline fixture before disconnect')
  await settings(page)
  await page.goto(origin)
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
  await page.reload()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  await context.setOffline(true)
  await page.reload()
  await expect(note(page)).toContainText('Offline fixture before disconnect')
  const revision = await page.evaluate(() => localStorage.getItem('rivolo.db.persisted-revision'))
  await note(page).fill('Offline fixture after edit café')
  await settings(page)
  await page.goto(origin)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('rivolo.db.persisted-revision'))).not.toBe(revision)
  await page.reload()
  await expect(note(page)).toContainText('Offline fixture after edit café')
  await context.setOffline(false)
})
