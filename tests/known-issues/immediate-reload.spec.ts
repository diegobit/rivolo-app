import { test, expect, type Page } from 'playwright/test'

const editor = (page: Page) => page.locator('.cm-content[contenteditable="true"]').first()

async function saveThroughNavigation(page: Page) {
  if ((page.viewportSize()?.width ?? 1440) < 640) {
    await page.getByRole('button', { name: /^Menu(?:,|$)/ }).click()
  }
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible()
  await page.goto('/')
}

// BUG-1: separate executable repro for the existing PWA-close follow-up.
// Keep the intended outcome. This command currently exits nonzero; it neither
// marks the loss expected nor silently skips a critical lifecycle contract.
for (const saved of [false, true]) {
  test(`immediate reload preserves ${saved ? 'a saved note’s latest edit' : 'a new note'}`, async ({ page }, info) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Start Today' }).click()
    await expect(editor(page)).toBeVisible()
    if (saved) {
      await editor(page).fill('Previously saved baseline')
      await saveThroughNavigation(page)
      await expect(editor(page)).toHaveText('Previously saved baseline')
    }
    const latest = 'Latest interrupted edit café 🙂'
    await editor(page).fill(latest)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Start Today' }).or(editor(page))).toBeVisible()
    const reopened = await editor(page).count() ? await editor(page).innerText() : '<onboarding; no note>'
    await info.attach('reopened-note', { body: JSON.stringify({ latest, reopened }), contentType: 'application/json' })
    await expect(editor(page)).toHaveText(latest, { timeout: 2000 })
  })
}
