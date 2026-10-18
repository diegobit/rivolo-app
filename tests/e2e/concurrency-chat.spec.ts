import { test, expect, type Page, type Locator } from 'playwright/test'
import { downloadArchive } from './helpers/archive'
import { readPersistedContent, waitForPersistedContent } from './helpers/persisted'
import { createFixtureProvider } from './helpers/fixtureProvider'

const note = (page: Page) => page.locator('.cm-content[contenteditable="true"]').first()
const mobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 640
const revision = (page: Page) => page.evaluate(() => localStorage.getItem('rivolo.db.persisted-revision'))

async function start(page: Page, origin = '/') {
  await page.goto(origin)
  await page.getByRole('button', { name: 'Start Today' }).click()
  await expect(note(page)).toBeVisible()
  const dayId = await page.evaluate(() => {
    const date = new Date()
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  })
  await waitForPersistedContent(page, saved =>
    saved.days.some(day => day.day_id === dayId && day.content_md === ''),
  )
  return dayId
}

async function saveNote(page: Page, dayId: string, text: string) {
  await note(page).fill(text)
  await waitForPersistedContent(page, saved =>
    saved.days.some(day => day.day_id === dayId && day.content_md === text),
  )
}

for (const transport of ['BroadcastChannel', 'storage fallback'] as const) {
  test(`J5: real ${transport} invalidates a second tab and reload recovers persisted notes`, async ({ page, context }) => {
    if (transport === 'storage fallback') {
      await context.addInitScript(() => { Object.defineProperty(window, 'BroadcastChannel', { value: undefined }) })
    }
    const dayId = await start(page)
    await saveNote(page, dayId, 'Original shared note café')
    const signals: string[] = []
    await page.exposeFunction('recordDatabaseSignal', (kind: string) => signals.push(kind))
    await page.evaluate(() => {
      const record = (window as unknown as { recordDatabaseSignal: (kind: string) => void }).recordDatabaseSignal
      window.addEventListener('storage', event => {
        if (event.key === 'rivolo.db.persisted-revision') record('storage fallback')
      })
      if (typeof BroadcastChannel !== 'undefined') {
        const witness = new BroadcastChannel('rivolo-db')
        witness.onmessage = () => record('BroadcastChannel')
      }
    })
    const second = await context.newPage()
    const beforeOpen = await revision(page)
    await second.goto('/')
    await expect(note(second)).toHaveText('Original shared note café')
    // Settings bootstrap persists migrations even for an already configured
    // database. The newest tab is therefore the writer; the old tab is stale.
    await expect.poll(() => revision(second)).not.toBe(beforeOpen)
    signals.length = 0
    await saveNote(second, dayId, 'Updated shared note café — preserve me')
    await expect.poll(() => signals).toContain(transport)
    // Browser inertness blocks real input rather than relying on a mocked guard.
    await expect(note(page).locator('xpath=ancestor::*[@inert]').first()).toHaveCount(1)
    const bounds = await note(page).boundingBox()
    await page.mouse.click(bounds!.x + 10, bounds!.y + 10)
    await page.keyboard.type('Stale overwrite must not reach the editor')
    await expect(note(page)).toHaveText('Original shared note café')
    await expect(note(page)).not.toContainText('Stale overwrite')
    await second.close()
    if (mobile(page)) await page.getByRole('button', { name: /^Menu(?:,|$)/ }).click()
    const reload = page.getByRole('button', { name: mobile(page) ? 'Reload' : 'Reload stale tab', exact: true })
    await expect(reload).toBeVisible()
    await reload.click()
    await expect(note(page)).toHaveText('Updated shared note café — preserve me')
    await expect(note(page).locator('xpath=ancestor::*[@inert]').first()).toHaveCount(0)
    await page.reload()
    await expect(note(page)).toHaveText('Updated shared note café — preserve me')
  })
}

async function configure(page: Page, url: string, origin: string) {
  if (mobile(page)) await page.getByRole('button', { name: /^Menu(?:,|$)/ }).click()
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await waitForPersistedContent(page, saved => {
    const providers = JSON.parse(saved.settings['llm.providers'] ?? '{}') as Record<string, unknown>
    return Boolean(providers['openai-compatible'])
  })
  await page.getByRole('button', { name: /OpenAI-compatible/, exact: false }).click()
  await page.getByLabel('Base URL', { exact: true }).fill(url)
  await page.getByLabel('Base URL', { exact: true }).press('Enter')
  await expect(page.getByLabel('Base URL', { exact: true })).toHaveValue(url)
  await page.getByLabel('Model', { exact: true }).fill('qa-model')
  await page.getByLabel('Model', { exact: true }).press('Enter')
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('qa-model')
  await expect.poll(async () => {
    const saved = await readPersistedContent(page)
    const providers = JSON.parse(saved.settings['llm.providers'] ?? '{}') as Record<
      string,
      { model?: string; baseUrl?: string }
    >
    return providers['openai-compatible']?.model
  }).toBe('qa-model')
  const configured = await readPersistedContent(page)
  const providers = JSON.parse(configured.settings['llm.providers'] ?? '{}') as Record<
    string,
    { model?: string; baseUrl?: string }
  >
  expect(providers['openai-compatible']).toMatchObject({ model: 'qa-model', baseUrl: url })
  await page.getByRole('button', { name: 'Use OpenAI-compatible', exact: true }).click()
  await expect(page.getByText('OpenAI-compatible is now the active provider.', { exact: true })).toBeVisible()
  await waitForPersistedContent(page, saved => {
    const providers = JSON.parse(saved.settings['llm.providers'] ?? '{}') as Record<
      string,
      { model?: string; baseUrl?: string }
    >
    const compatible = providers['openai-compatible']
    return saved.settings['llm.provider'] === 'openai-compatible' &&
      compatible?.model === 'qa-model' &&
      compatible?.baseUrl === url
  })
  await page.goto(origin)
  if (mobile(page)) await page.getByRole('button', { name: /^Menu(?:,|$)/ }).click()
  await page.getByRole('button', { name: 'Chat', exact: true }).click()
}

const scroller = (page: Page) => mobile(page)
  ? page.locator('.fixed.inset-0.z-20 .overflow-y-auto')
  : page.locator('.timeline-chat-sidebar-messages')
const remainingScroll = (target: Locator) => target.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)

test('J6: actual streamed chat preserves a reader, follows reflow, navigates grounded citation, and safely persists one insert', async ({ page }, testInfo) => {
  // Loopback HTTP avoids mixed-content policy blocking the external SSE fixture.
  const origin = `http://127.0.0.1:${Number(new URL(String(testInfo.project.use.baseURL)).port) + 2}`
  await page.addInitScript(() => Object.defineProperty(navigator, 'canShare', { value: () => false }))
  const endpoint = await createFixtureProvider()
  try {
    const day = await start(page, origin)
    const original = `${Array.from({ length: 40 }, (_, i) => `Context line ${i + 1}`).join('\n')}\nCitation destination café`
    await saveNote(page, day, original)
    await configure(page, endpoint.url, origin)
    await page.getByPlaceholder('Ask Rivolo').fill('Explain the source and add Requested safe note. Keep code examples literal.')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const response = await endpoint.request()
    expect(JSON.stringify(response.body.messages)).toContain('Citation destination café')
    response.chunk(`${Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1}: a long explanation with useful context for the reader.\n\n`).join('')}\n`)
    await expect(page.getByLabel('Assistant is streaming')).toBeVisible()
    const list = scroller(page)
    await expect.poll(() => remainingScroll(list)).toBeLessThan(2)
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(200)
    if (mobile(page)) {
      await list.evaluate(element => { element.scrollTop = 100 })
    } else {
      await list.hover()
      const currentScrollTop = await list.evaluate(element => element.scrollTop)
      await page.mouse.wheel(0, -Math.ceil(currentScrollTop + 110))
    }
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeLessThan(110)
    response.chunk('New streamed paragraph while the reader is above.\n\n')
    const unseen = page.getByRole('button', { name: /New messages/ })
    await expect(unseen).toBeVisible()
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeLessThan(110)
    await unseen.click()
    await expect.poll(() => remainingScroll(list)).toBeLessThan(2)
    if (!mobile(page)) await expect(list).toHaveAttribute('data-following', 'true')
    await list.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const viewport = page.viewportSize()!
    await page.setViewportSize({ width: mobile(page) ? 360 : 1050, height: viewport.height - 80 })
    await expect.poll(() => remainingScroll(list)).toBeLessThan(2)
    response.chunk('A short follow-up after the viewport reflow.\n\n')
    await expect.poll(() => remainingScroll(list)).toBeLessThan(2)
    if (mobile(page)) {
      await list.evaluate(element => { element.scrollTop = 100 })
    } else {
      await list.hover()
      await page.mouse.wheel(0, -500)
    }
    await expect.poll(() => remainingScroll(list)).toBeGreaterThan(48)
    if (!mobile(page)) await expect(list).toHaveAttribute('data-following', 'false')
    const olderPosition = await list.evaluate(element => element.scrollTop)
    response.chunk('Another streamed paragraph while reading older messages.\n\n')
    await expect(page.getByRole('button', { name: /New messages/ })).toBeVisible()
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeLessThan(olderPosition + 8)
    const resizedViewport = page.viewportSize()!
    await page.setViewportSize({
      width: mobile(page) ? 340 : 980,
      height: resizedViewport.height - 40,
    })
    await expect.poll(() => remainingScroll(list)).toBeGreaterThan(48)
    await expect(page.getByRole('button', { name: /New messages/ })).toBeVisible()
    response.chunk('```xml\n<insert text="Forbidden literal mutation"/>\n```\n\nGrounded claim <ref day="')
    await expect(page.getByRole('button', { name: /^Open citation from/ })).toHaveCount(0)
    response.chunk(`${day}" quote="Citation destination café"/>\n<insert text="Requested safe note" target_day="${day}"/>`)
    response.finish()
    await expect(page.getByLabel('Assistant is streaming')).toHaveCount(0)
    await expect(page.getByRole('status').filter({ hasText: `Added to ${day}` })).toBeVisible()
    const citation = page.getByRole('button', { name: `Open citation from ${day}`, exact: true })
    await expect(citation).toHaveCount(1)
    await citation.click()
    const destination = page.locator('.cm-highlight').filter({ hasText: 'Citation destination café' }).first()
    await expect(destination).toBeVisible()
    await expect(destination).toBeInViewport({ ratio: 1 })
    const box = await destination.boundingBox()
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
    await expect(note(page)).toContainText('Requested safe note')
    await expect(note(page)).not.toContainText('Forbidden literal mutation')
    await waitForPersistedContent(page, saved =>
      saved.days.some(entry =>
        entry.day_id === day &&
        entry.content_md === `${original}\n\nRequested safe note`,
      ),
    )
    await page.reload()
    await expect(note(page)).toContainText('Context line 1')
    // CodeMirror renders only its viewport; the durable inserted text is below
    // the first screen. Real document scrolling brings it into the DOM.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await expect(note(page)).toContainText('Citation destination café')
    await expect(note(page)).toContainText('Requested safe note')
    await expect(note(page)).not.toContainText('Forbidden literal mutation')
    if (mobile(page)) await page.getByRole('button', { name: /^Menu(?:,|$)/ }).click()
    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    const archive = await downloadArchive(page)
    expect(archive.split('Requested safe note').length - 1).toBe(1)
    expect(archive).toContain(original)
    expect(archive).not.toContain('Forbidden literal mutation')
  } finally { await endpoint.close() }
})
