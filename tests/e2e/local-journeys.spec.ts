import { test, expect, type Page, type Locator } from 'playwright/test'
import { waitForPersistedContent } from './helpers/persisted'

const note = (page: Page) => page.locator('.cm-content[contenteditable="true"]').first()
const mobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 640

async function start(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Start Today' }).click()
  await expect(note(page)).toBeVisible()
}

async function settings(page: Page) {
  if (mobile(page)) await page.getByRole('button', { name: /^Menu(?:,|$)/ }).click()
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible()
}

async function search(page: Page, query: string) {
  if (mobile(page)) {
    await page.getByRole('button', { name: /^Menu(?:,|$)/ }).click()
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
  const lines = page.getByRole('button', { name: 'Lines', exact: true })
  if (mobile(page)) {
    const days = page.getByRole('button', { name: 'Days', exact: true })
    await expect(days).toHaveAttribute('aria-pressed', 'true')
    await expect(lines).toBeVisible()
    await expect(lines).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByRole('button', { name: 'Filter', exact: true })).toBeVisible()
    await lines.click()
    await expect(lines).toHaveAttribute('aria-pressed', 'true')
    await expect(days).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByText('Meet @Renée #café for 100% planning', { exact: false }).first()).toBeVisible()
    await days.click()
    await expect(lines).toHaveAttribute('aria-pressed', 'false')
    await expect(days).toHaveAttribute('aria-pressed', 'true')
    await expect(note(page)).toContainText('[ ] buy tea')
  } else {
    await expect(lines).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'TODOs', exact: true })).toBeVisible()
    await expect(note(page)).toBeVisible()
  }
})

test('J4: appearance changes persist; fonts render; controls and preview stay contained', async ({ page }) => {
  await start(page)
  await settings(page)
  const openSyncReminder = page.getByRole('button', { name: 'Open Cloud sync is off', exact: true })
  await expect(openSyncReminder).toBeVisible()
  const syncScrollPosition = await page.locator('#settings-sync').evaluate(element => {
    const start = window.scrollY + element.getBoundingClientRect().top - Number.parseFloat(getComputedStyle(element).scrollMarginTop)
    return Math.max(0, Math.min(start, document.documentElement.scrollHeight - window.innerHeight))
  })
  await openSyncReminder.click()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(syncScrollPosition, 0)
  await insideViewport(page, page.getByRole('heading', { name: 'Cloud sync', exact: true }))
  await page.getByRole('button', { name: 'Dismiss Cloud sync is off', exact: true }).click()
  await page.getByRole('button', { name: 'Advanced', exact: true }).click()
  await expect(page.getByLabel('Title font', { exact: true })).toHaveValue('handlee')
  await expect(page.getByLabel('Body font', { exact: true })).toHaveValue('iawriter')
  const theme = page.getByRole('group', { name: 'Theme', exact: true })
  await theme.getByRole('button', { name: 'Dark', exact: true }).click()
  await page.getByLabel('Title font', { exact: true }).selectOption('bree')
  await page.getByLabel('Body font', { exact: true }).selectOption('inconsolata')
  await page.getByRole('button', { name: 'Rivolo Strong', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Rivolo Strong', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(theme.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await waitForPersistedContent(page, ({ settings: saved }) =>
    saved['appearance.wallpaper'] === 'thoughts-high' &&
    saved['appearance.theme'] === 'dark' &&
    saved['appearance.titleFont'] === 'bree' &&
    saved['appearance.font'] === 'monospace' &&
    saved['appearance.monospaceFont'] === 'inconsolata' &&
    saved['setup.dismissedSync'] === 'true',
  )
  await page.reload()
  await expect(page.getByRole('button', { name: "Dismiss AI assistant isn't set up", exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Dismiss Cloud sync is off', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Advanced', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Title font', { exact: true })).toHaveValue('bree')
  await expect(page.getByLabel('Body font', { exact: true })).toHaveValue('inconsolata')
  await expect(theme.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.evaluate(() => document.fonts.ready)
  const sample = page.getByText('@bob send message for breakfast at 8:30', { exact: true }).first()
  expect(await sample.evaluate(element => getComputedStyle(element).fontFamily)).toContain('Inconsolata')
  const fontSample = sample.locator('../..')
  expect(await fontSample.getByText('Today', { exact: true }).evaluate(element => getComputedStyle(element).fontFamily)).toContain('Bree Serif')
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
    const contentHeight = await fontSample.locator('p').evaluateAll(elements => {
      const first = elements[0].getBoundingClientRect()
      const last = elements[elements.length - 1].getBoundingClientRect()
      return last.bottom - first.top
    })
    // The wallpaper sample has the same typography and wrapping as the visible
    // font sample, with 12px padding above and below the content.
    expect(dimensions!.height).toBeCloseTo(contentHeight + 24, 0)
    const image = preview.locator(':scope > div').last()
    await expect.poll(() => image.evaluate(element => Number(getComputedStyle(element).opacity))).toBeCloseTo(0.2, 2)
    expect(await image.evaluate(element => getComputedStyle(element).backgroundAttachment)).toBe('fixed')
    expect(await image.evaluate(element => getComputedStyle(element).backgroundImage)).toContain('/bg-thoughts.jpg')
  } else {
    await expect(page.getByRole('img', { name: 'Rivolo Strong background preview' })).toBeHidden()
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('J7: mobile menu preserves draft, restores focus, and exposes contained touch targets', async ({ page }) => {
  test.skip(!mobile(page), 'Narrow viewport interaction contract')
  await start(page)
  const draft = page.getByPlaceholder('Ask Rivolo')
  await draft.fill('Keep this unsent draft 🙂')
  const menu = page.getByRole('button', { name: /^Menu(?:,|$)/ })
  await insideViewport(page, menu, 44)
  await insideViewport(page, page.getByRole('button', { name: 'Send', exact: true }), 44)
  await menu.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const mode = dialog.getByRole('group', { name: 'Mode' })
  await insideViewport(page, mode.getByRole('button', { name: 'Search', exact: true }), 44)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(draft).toBeFocused()
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
  const markdown = '<!-- day:2024-01-03 -->\nJanuary 3\n---\n\nArchive café 100%\n[ ] keep me\n' +
    Array.from({ length: 150 }, (_, index) => `Archive line ${index}\n`).join('')
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
  const returnToToday = page.getByRole('button', { name: 'Scroll to Today', exact: true })
  const checkReturnGeometry = async () => {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await insideViewport(page, returnToToday, mobile(page) ? 44 : 40)
    const button = await returnToToday.boundingBox()
    const icon = await returnToToday.locator('img').boundingBox()
    expect(icon!.width).toBeCloseTo(20, 0)
    expect(icon!.height).toBeCloseTo(20, 0)
    if (mobile(page)) {
      expect(button!.x + button!.width / 2).toBeCloseTo(page.viewportSize()!.width / 2, 0)
      const tray = await page.locator('#bottom-tray').boundingBox()
      expect(button!.y + button!.height).toBeLessThanOrEqual(tray!.y)
    } else {
      const capsule = await page.locator('.bottom-tray-launchers').boundingBox()
      expect(button!.x + button!.width / 2).toBeCloseTo(capsule!.x + capsule!.width / 2, 0)
      expect(button!.y + button!.height).toBeLessThanOrEqual(capsule!.y - 9)
    }
  }
  if (!mobile(page)) await page.getByRole('button', { name: 'Chat', exact: true }).click()
  await checkReturnGeometry()
  await returnToToday.click()
  await expect.poll(() => page.locator('[data-scroll-target="today"]').evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return bounds.top >= -1 && bounds.top < window.innerHeight / 2
  })).toBe(true)
  if (mobile(page)) {
    await search(page, 'Archive')
    await checkReturnGeometry()
  }
})

test('J2: search toggles the intended todo occurrence and preserves cancelled/other notes', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'canShare', { value: () => false }))
  await page.goto('/settings')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'occurrences.md', mimeType: 'text/markdown',
    buffer: Buffer.from('<!-- day:2024-01-03 -->\nJanuary 3\n---\n\n- [ ] tea #café\n- [ ] tea #café\n- [-] cancelled tea #café\n<!-- day:2024-01-02 -->\nJanuary 2\n---\n\n- [ ] other #café\n'),
  })
  await expect(page.getByText(/Imported 2 day/)).toBeVisible()
  await page.goto('/')
  await search(page, 'tea')
  if (mobile(page)) {
    await page.getByRole('button', { name: 'Lines', exact: true }).click()
    await page.getByRole('button', { name: 'Filter', exact: true }).click()
    await page.getByRole('menuitemradio', { name: 'TODOs', exact: true }).click()
  } else {
    await page.getByRole('button', { name: 'TODOs', exact: true }).click()
  }
  await expect(page.getByRole('button', { name: 'Toggle todo', exact: true })).toHaveCount(2)
  await page.getByRole('button', { name: 'Toggle todo', exact: true }).nth(1).click()
  // Export reads the independent persisted owner after route navigation flushes.
  await settings(page)
  await page.reload()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: /^Export .*\.md$/ }).click()
  const download = await pending
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  const archive = Buffer.concat(chunks).toString('utf8')
  expect(archive).toContain('- [ ] tea #café\n- [x] tea #café\n- [-] cancelled tea #café')
  expect(archive).toContain('[ ] other #café')
  await page.goto('/')
  await search(page, '#café')
  await expect(page.getByText('other #café', { exact: false }).first()).toBeVisible()
})

