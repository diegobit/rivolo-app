import { expect, test } from 'playwright/test'
import { connectDropbox } from './helpers/dropbox'

test.use({ serviceWorkers: 'block' })

// The browser owns the explicit upgrade action and its persisted status.
// The provider HTTP is routed.
test('Dropbox upgrade keeps the original and enables daily sync', async ({ page }, testInfo) => {
  const source = '<!-- day:2026-11-18 -->\nNotebook\n---\n\nKeep this note\n'
  await connectDropbox(page, { content: source, rev: 'original' })
  type FixtureEntry = { id: string; path: string; content?: string; rev?: string }
  const entries: FixtureEntry[] = [{ id: 'id:source', path: '/inbox.md', content: source, rev: 'original' }]
  let version = 0
  const metadata = (item: FixtureEntry) => ({
    '.tag': item.content === undefined ? 'folder' : 'file',
    id: item.id,
    path_display: item.path,
    path_lower: item.path.toLowerCase(),
    rev: item.rev,
  })
  await page.context().route(/https:\/\/(api|content)\.dropboxapi\.com\/2\/files\//, async (route) => {
    const action = new URL(route.request().url()).pathname.split('/').at(-1)
    const argument = route.request().headers()['dropbox-api-arg']
    const data = argument ? JSON.parse(argument) : route.request().postDataJSON()
    const entry = entries.find((item) => item.path === data.path || item.id === data.path || `rev:${item.rev}` === data.path)
    if (action === 'get_metadata') return entry
      ? route.fulfill({ json: metadata(entry) })
      : route.fulfill({ status: 409, json: { error_summary: 'path/not_found/' } })
    if (action === 'download' && entry) return route.fulfill({ body: entry.content ?? '' })
    if (action === 'list_folder' && entry) return route.fulfill({ json: {
      entries: entries.filter((child) => child.path.startsWith(entry.path + '/')).map(metadata),
      has_more: false,
      cursor: 'complete',
    } })
    if (action === 'create_folder_v2') {
      const folder = { id: `id:folder-${++version}`, path: data.path }
      entries.push(folder)
      return route.fulfill({ json: { metadata: metadata(folder) } })
    }
    if (action === 'upload') {
      if (entry?.id === 'id:source') return route.fulfill({ json: metadata(entry) })
      const uploaded = entry ?? { id: `id:day-${++version}`, path: data.path }
      uploaded.content = route.request().postData() ?? ''
      uploaded.rev = `rev-${++version}`
      if (!entry) entries.push(uploaded)
      return route.fulfill({ json: metadata(uploaded) })
    }
    throw new Error(`Unexpected Dropbox daily operation ${action}`)
  })

  const capture = async (name: string) => {
    if (!process.env.RIVOLO_DAILY_SCREENSHOTS) return
    await page.screenshot({ path: `${process.env.RIVOLO_DAILY_SCREENSHOTS}/${testInfo.project.name}-${name}.png` })
  }
  const upgrade = page.getByRole('button', { name: 'Upgrade to daily sync' })
  await expect(upgrade).toBeEnabled()
  await upgrade.scrollIntoViewIfNeeded()
  await capture('before')
  await upgrade.click()
  const status = page.getByText('Daily sync is on. Each day has its own Markdown file.')
  await expect(status).toBeVisible()
  await expect.poll(() => entries.find((item) => item.path.endsWith('/2026-11-18.md'))?.content).toContain('Keep this note')
  expect(entries.find((item) => item.path === '/inbox.md')?.content).toBe(source)
  await expect(upgrade).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await status.scrollIntoViewIfNeeded()
  await capture('after')

  await page.reload()
  await page.getByRole('button', { name: /^Dropbox / }).click()
  await expect(status).toBeVisible()
})
