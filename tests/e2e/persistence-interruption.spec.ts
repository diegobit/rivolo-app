import { test, expect, type Page } from 'playwright/test'
import { createFixtureProvider } from './helpers/fixtureProvider'
import { readPersistedContent, waitForPersistedContent } from './helpers/persisted'

const editor = (page: Page) => page.locator('.cm-content[contenteditable="true"]').first()
const mobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 640

async function startToday(page: Page, origin = '/') {
  await page.goto(origin)
  await page.getByRole('button', { name: 'Start Today' }).click()
  await expect(editor(page)).toBeVisible()
}

async function openSettings(page: Page) {
  if (mobile(page)) await page.getByRole('button', { name: /^Menu(?:,|$)/ }).click()
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Appearance', exact: true })).toBeVisible()
  await waitForPersistedContent(page, (saved) => {
    const providers = JSON.parse(saved.settings['llm.providers'] ?? '{}') as Record<string, unknown>
    return Boolean(providers['openai-compatible'])
  })
}

test('immediate reload preserves a new note edit', async ({ page }, testInfo) => {
  const latest = 'Latest interrupted edit café 🙂\nsecond line, punctuation — kept'
  await startToday(page)
  await editor(page).fill(latest)
  await page.reload()

  await expect(page.getByRole('button', { name: 'Start Today' }).or(editor(page))).toBeVisible()
  const saved = await readPersistedContent(page)
  await testInfo.attach('reopened-note-snapshot', {
    body: JSON.stringify(saved.days),
    contentType: 'application/json',
  })
  expect(saved.days).toContainEqual(expect.objectContaining({ content_md: latest }))
  await expect(editor(page).locator('.cm-line')).toHaveText([
    'Latest interrupted edit café 🙂',
    'second line, punctuation — kept',
  ])
})

test('immediate reload preserves a saved note’s latest edit', async ({ page }, testInfo) => {
  const baseline = 'Previously saved baseline'
  const latest = 'Latest interrupted edit café 🙂\nsecond line, punctuation — kept'
  await startToday(page)
  await editor(page).fill(baseline)
  await waitForPersistedContent(page, (saved) =>
    saved.days.some((day) => day.content_md === baseline),
  )
  await editor(page).fill(latest)
  await page.reload()

  await expect(editor(page)).toBeVisible()
  const saved = await readPersistedContent(page)
  await testInfo.attach('reopened-note-snapshot', {
    body: JSON.stringify(saved.days),
    contentType: 'application/json',
  })
  expect(saved.days).toContainEqual(expect.objectContaining({ content_md: latest }))
  await expect(editor(page).locator('.cm-line')).toHaveText([
    'Latest interrupted edit café 🙂',
    'second line, punctuation — kept',
  ])
})

test('provider activation survives immediate navigation and reaches its configured endpoint', async ({ page }, testInfo) => {
  const origin = `http://127.0.0.1:${Number(new URL(String(testInfo.project.use.baseURL)).port) + 2}`
  const endpoint = await createFixtureProvider()
  try {
    await startToday(page, origin)
    await openSettings(page)
    await page.getByRole('button', { name: /OpenAI-compatible/ }).click()
    await page.getByLabel('Base URL', { exact: true }).fill(endpoint.url)
    await page.getByLabel('Base URL', { exact: true }).press('Enter')
    await expect(page.getByLabel('Base URL', { exact: true })).toHaveValue(endpoint.url)
    await page.getByLabel('Model', { exact: true }).fill('qa-model')
    await page.getByLabel('Model', { exact: true }).press('Enter')
    await expect(page.getByLabel('Model', { exact: true })).toHaveValue('qa-model')
    const activate = page.getByRole('button', { name: 'Use OpenAI-compatible', exact: true })
    await expect(activate).toBeEnabled()
    await activate.click()
    await expect(
      page.getByText('OpenAI-compatible is now the active provider.', { exact: true }),
    ).toBeVisible()

    await page.goto(origin)
    const saved = await readPersistedContent(page)
    const providers = JSON.parse(saved.settings['llm.providers'] ?? '{}') as Record<
      string,
      { model?: string; baseUrl?: string }
    >
    await testInfo.attach('reopened-provider-snapshot', {
      body: JSON.stringify(saved.settings),
      contentType: 'application/json',
    })
    expect(saved.settings['llm.provider']).toBe('openai-compatible')
    expect(providers['openai-compatible']).toMatchObject({ model: 'qa-model', baseUrl: endpoint.url })

    if (mobile(page)) await page.getByRole('button', { name: /^Menu(?:,|$)/ }).click()
    await page.getByRole('button', { name: 'Chat', exact: true }).click()
    await page.getByPlaceholder('Ask Rivolo').fill('Confirm this configured provider is active.')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const request = await endpoint.request()
    expect(JSON.stringify(request.body.messages)).toContain('Confirm this configured provider is active.')
    request.chunk('Configured provider reached.')
    request.finish()
    await expect(page.getByText('Configured provider reached.', { exact: true })).toBeVisible()
  } finally {
    await endpoint.close()
  }
})

test('Strong appearance selection survives immediate reload', async ({ page }, testInfo) => {
  await startToday(page)
  await openSettings(page)
  await page.getByRole('button', { name: 'Advanced', exact: true }).click()
  await waitForPersistedContent(page, (saved) => saved.settings['settings.view'] === 'advanced')
  await page.getByRole('button', { name: 'Rivolo Strong', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Rivolo Strong', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.reload()

  const saved = await readPersistedContent(page)
  await testInfo.attach('reopened-appearance-snapshot', {
    body: JSON.stringify(saved.settings),
    contentType: 'application/json',
  })
  expect(saved.settings['appearance.wallpaper']).toBe('thoughts-high')
  const strong = page.getByRole('button', { name: 'Rivolo Strong', exact: true })
  await expect(strong).toHaveAttribute('aria-pressed', 'true')
})
