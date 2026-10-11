import { test, expect, type Page, type Locator } from 'playwright/test'

const note = (page: Page) => page.locator('.cm-content[contenteditable="true"]').first()
const mobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 640

async function start(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Start Today' }).click()
  await expect(note(page)).toBeVisible()
}

async function settings(page: Page) {
  if (mobile(page)) await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible()
}

async function search(page: Page, query: string) {
  if (mobile(page)) {
    await page.getByRole('button', { name: 'Menu', exact: true }).click()
    await page.getByRole('button', { name: 'Search', exact: true }).click()
  } else {
    await page.getByRole('button', { name: 'Search', exact: true }).click()
  }
  await page.getByPlaceholder('Search all days').fill(query)
}

async function insideViewport(page: Page, target: Locator, minimum = 0) {
  await expect(target).toBeVisible()
  await expect.poll(async () => {
    const bounds = await target.boundingBox()
    return Boolean(bounds && bounds.y >= -1 && bounds.y + bounds.height <= page.viewportSize()!.height + 1)
  }).toBe(true)
  const box = await target.boundingBox()
  expect(box).not.toBeNull()
  const size = page.viewportSize()!
  expect(box!.x).toBeGreaterThanOrEqual(-1)
  expect(box!.y).toBeGreaterThanOrEqual(-1)
  expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 1)
  expect(box!.y + box!.height).toBeLessThanOrEqual(size.height + 1)
  expect(box!.width).toBeGreaterThanOrEqual(minimum)
  expect(box!.height).toBeGreaterThanOrEqual(minimum)
}

test('J1: edit, flush through navigation, reopen, and search literal Unicode text', async ({ page }) => {
  await start(page)
  await note(page).fill('Meet @Renée #café for 100% planning\n[ ] buy tea')
  // Navigation uses the real editor flush and SQLite/IndexedDB owners. Reload
  // is the independent oracle: text held only in React cannot satisfy it.
  await settings(page)
  await page.goto('/')
  await page.reload()
  await expect(note(page)).toContainText('Meet @Renée #café for 100% planning')
  await search(page, '100%')
  await expect(page.getByText('Meet @Renée #café for 100% planning', { exact: false }).first()).toBeVisible()
  const modes = page.getByRole('group', { name: 'Show results as' })
  if (mobile(page)) {
    await expect(modes).toBeVisible()
    await modes.getByRole('button', { name: 'Show Lines' }).click()
    await expect(page.getByText('Meet @Renée #café for 100% planning', { exact: false }).first()).toBeVisible()
  } else {
    await expect(modes).toHaveCount(0)
    await expect(note(page)).toBeVisible()
  }
})

test('J4: appearance changes persist; fonts render; controls and preview stay contained', async ({ page }) => {
  await start(page)
  await settings(page)
  await page.getByRole('button', { name: 'Advanced', exact: true }).click()
  const theme = page.getByRole('group', { name: 'Theme', exact: true })
  await theme.getByRole('button', { name: 'Dark', exact: true }).click()
  await page.getByLabel('Title font', { exact: true }).selectOption('bree')
  await page.getByLabel('Body font', { exact: true }).selectOption('inconsolata')
  const revision = await page.evaluate(() => localStorage.getItem('rivolo.db.persisted-revision'))
  await page.getByRole('button', { name: 'Rivolo Strong', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Rivolo Strong', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('rivolo.db.persisted-revision'))).not.toBe(revision)
  await expect(theme.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Advanced', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Title font', { exact: true })).toHaveValue('bree')
  await expect(page.getByLabel('Body font', { exact: true })).toHaveValue('inconsolata')
  await expect(theme.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.evaluate(() => document.fonts.ready)
  const sample = page.getByText('@bob send message for breakfast at 8:30', { exact: true }).first()
  expect(await sample.evaluate(element => getComputedStyle(element).fontFamily)).toContain('Inconsolata')
  const themeButtons = theme.getByRole('button')
  const widths = await themeButtons.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().width))
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1)
  const selected = await theme.getByRole('button', { name: 'Dark', exact: true }).boundingBox()
  const thumb = await theme.locator(':scope > [aria-hidden]').boundingBox()
  expect(thumb!.x).toBeCloseTo(selected!.x, 0)
  expect(thumb!.width).toBeCloseTo(selected!.width, 0)
  if (mobile(page)) {
    const preview = page.getByRole('img', { name: 'Rivolo Strong background preview' })
    await preview.scrollIntoViewIfNeeded()
    await insideViewport(page, preview)
    const dimensions = await preview.boundingBox()
    expect(dimensions!.height).toBeGreaterThan(140)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('J7: mobile menu preserves draft, restores focus, and exposes contained touch targets', async ({ page }) => {
  test.skip(!mobile(page), 'Narrow viewport interaction contract')
  await start(page)
  const draft = page.getByPlaceholder('Ask Rivolo')
  await draft.fill('Keep this unsent draft 🙂')
  const menu = page.getByRole('button', { name: 'Menu', exact: true })
  await insideViewport(page, menu, 44)
  await menu.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const mode = dialog.getByRole('group', { name: 'Mode' })
  await insideViewport(page, mode.getByRole('button', { name: 'Search', exact: true }), 44)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(menu).toBeFocused()
  await expect(draft).toHaveValue('Keep this unsent draft 🙂')
  await insideViewport(page, page.getByRole('button', { name: 'Tomorrow', exact: true }), 44)
  await expect(draft).toHaveValue('Keep this unsent draft 🙂')
})

test('J3: import, export, malformed import, and reopen preserve actual notes', async ({ page }) => {
  // Exercise the download branch rather than the host OS share sheet, whose
  // completion is outside browser automation. App export/serialization is real.
  await page.addInitScript(() => Object.defineProperty(navigator, 'canShare', { value: () => false }))
  await start(page)
  await settings(page)
  const input = page.locator('input[type="file"]')
  const markdown = '<!-- day:2024-01-03 -->\nJanuary 3\n---\n\nArchive café 100%\n[ ] keep me\n'
  await input.setInputFiles({ name: 'archive.md', mimeType: 'text/markdown', buffer: Buffer.from(markdown) })
  await expect(page.getByText(/Imported 1 day/)).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /^Export .*\.md$/ }).click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  const exported = Buffer.concat(chunks).toString('utf8')
  expect(exported).toContain('Archive café 100%')
  expect(exported).toContain('2024-01-03')
  await input.setInputFiles({ name: 'bad.md', mimeType: 'text/markdown', buffer: Buffer.from('not a day archive') })
  await expect(page.getByText(/Imported 0 day\(s\)/)).toBeVisible()
  await page.goto('/')
  await page.reload()
  await expect(page.getByText('Archive café 100%', { exact: false }).first()).toBeVisible()
})
