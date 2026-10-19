import { expect, type Page } from 'playwright/test'

export type RemoteArchive = { content: string; rev: string }

// Only external Dropbox HTTP is simulated; callback, exchange and cookie writes
// use actual Pages handlers. Mutable remote content models a new cloud revision.
export async function connectDropbox(page: Page, remote: RemoteArchive = {
  content: '<!-- day:2024-01-03 -->\nJanuary 3\n---\n\nCloud fixture\n', rev: 'fixture-rev',
}) {
  expect((await page.request.post('/__fixtures/new')).ok()).toBe(true)
  // Simulate only Dropbox's external authorization and provider responses.
  // Session state, callback, code exchange, cookie encryption, and persistence are real.
  await page.context().route('https://www.dropbox.com/oauth2/authorize?**', route => {
    const url = new URL(route.request().url())
    const callback = new URL(url.searchParams.get('redirect_uri')!)
    callback.searchParams.set('state', url.searchParams.get('state')!)
    callback.searchParams.set('code', 'fixture-code')
    return route.fulfill({ contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(callback.href)})</script>` })
  })
  await page.context().route(/https:\/\/(api|content)\.dropboxapi\.com\//, async route => {
    const path = new URL(route.request().url()).pathname
    const meta = { '.tag': 'file', name: 'inbox.md', id: 'fixture-file', path_display: '/rivolo/inbox.md', path_lower: '/rivolo/inbox.md', rev: remote.rev, size: 32 }
    if (path === '/2/users/get_current_account') return route.fulfill({ json: { account_id: 'browser-fixture-account', email: 'fixture@example.test', name: { display_name: 'Browser Fixture' } } })
    if (path === '/2/files/get_metadata' || path === '/2/files/upload') return route.fulfill({ json: meta })
    if (path === '/2/files/download') return route.fulfill({ body: remote.content, headers: { 'Dropbox-API-Result': JSON.stringify(meta) } })
    throw new Error(`Unexpected browser provider request ${path}`)
  })
  await page.goto('/settings')
  await page.getByRole('button', { name: /^Dropbox / }).click()
  const revision = await page.evaluate(() => localStorage.getItem('rivolo.db.persisted-revision'))
  const exchanged = page.waitForResponse(response => response.url().endsWith('/api/dropbox/exchange'))
  await page.getByRole('button', { name: 'Connect Dropbox', exact: true }).click()
  expect((await exchanged).status()).toBe(200)
  await expect(page).toHaveURL(/\/settings$/)
  await page.getByRole('button', { name: /^Dropbox / }).click()
  await expect(page.getByText('Browser Fixture · fixture@example.test', { exact: true })).toBeVisible()
  return revision
}
