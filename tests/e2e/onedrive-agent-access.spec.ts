import { expect, test } from 'playwright/test'

test.use({ serviceWorkers: 'block' })

// J8's browser owner verifies migration readiness and revocation before a
// target change or disconnect. Graph and Microsoft's sign-in are the fixtures.
test('OneDrive Agent access follows the daily folder and revokes before changing it', async ({ page }, testInfo) => {
  const folderAddress = '/drives/fixture-drive/items/fixture-folder'
  const folder = { id: 'fixture-folder', name: 'Agent test notebook', folder: {}, parentReference: { driveId: 'fixture-drive', id: 'root' } }
  let notebookReady = false
  let relayReady = false
  await page.routeWebSocket('wss://**/api/onedrive/daily-events?**', (socket) => {
    socket.send(JSON.stringify({ type: 'ready' }))
    socket.onMessage((message) => { if (message === 'ping') socket.send('pong') })
    relayReady = true
  })
  await page.context().route('https://login.microsoftonline.com/common/oauth2/v2.0/authorize?**', (route) => {
    const url = new URL(route.request().url())
    const callback = new URL(url.searchParams.get('redirect_uri')!)
    callback.searchParams.set('state', url.searchParams.get('state')!)
    callback.searchParams.set('code', 'fixture-onedrive-code')
    return route.fulfill({ contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(callback.href)})</script>` })
  })
  await page.context().route('https://graph.microsoft.com/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/v1.0/me') return route.fulfill({ json: { id: 'browser-onedrive-account', displayName: 'Ari Fixture', mail: 'ari@example.test' } })
    if (path === '/v1.0/me/drive/root:/Rivolo' || path === `/v1.0${folderAddress}`) {
      return notebookReady ? route.fulfill({ json: folder }) : route.fulfill({ status: 403 })
    }
    if (path === '/v1.0/me/drive/root:/Another%20test%20notebook') return route.fulfill({ status: 403 })
    if (path === `/v1.0${folderAddress}/children`) return route.fulfill({ json: { value: [] } })
    throw new Error(`Unexpected browser Graph route: ${path}`)
  })
  const activate = async (name: string) => {
    const button = page.getByRole('button', { name, exact: true })
    if (testInfo.project.name === 'webkit-mobile') await button.tap()
    else await button.click()
  }
  const checkWidth = async () => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }

  await page.goto('/settings')
  await page.getByRole('button', { name: /^OneDrive / }).click()
  await activate('Connect OneDrive')
  await expect(page).toHaveURL(/\/settings$/)
  await page.getByRole('button', { name: /^OneDrive / }).click()
  await expect(page.getByText('ari@example.test', { exact: true })).toBeVisible()
  await checkWidth()

  const panel = page.locator('details').filter({ has: page.getByRole('heading', { name: 'Agent access' }) })
  const summary = panel.locator('summary')
  if (testInfo.project.name === 'webkit-mobile') await summary.tap()
  else {
    await summary.focus()
    await page.keyboard.press('Enter')
  }
  const enable = page.getByRole('button', { name: 'Enable for OneDrive', exact: true })
  await expect(enable).toBeDisabled()
  notebookReady = true
  await activate('Pull from OneDrive')
  await expect(enable).toBeEnabled()
  await expect.poll(() => relayReady).toBe(true)
  await activate('Enable for OneDrive')
  await expect(page.getByText('No access tokens yet.', { exact: true })).toBeVisible()
  await activate('Advanced')
  await expect(panel.getByText('Agent test notebook', { exact: true })).toBeVisible()
  await checkWidth()
  const initialViewport = page.viewportSize()!
  for (const width of testInfo.project.name === 'webkit-mobile' ? [320, 375] : [1280]) {
    await page.setViewportSize({ ...initialViewport, width })
    await checkWidth()
    await expect(page.getByRole('button', { name: 'Disable Agent access', exact: true })).toBeVisible()
  }
  await summary.scrollIntoViewIfNeeded()
  const screenshotDir = process.env.RIVOLO_ONEDRIVE_SCREENSHOTS
  if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/${testInfo.project.name}-after.png`, scale: 'css' })

  await page.getByLabel('Token name', { exact: true }).fill('OneDrive fixture agent')
  await activate('Create token')
  const token = await page.getByLabel('New access token', { exact: true }).inputValue()
  const listTools = () => page.request.post('/mcp', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
  })
  expect((await listTools()).status()).toBe(200)
  await activate('I saved it — dismiss')

  const target = page.getByLabel('Shared folder link or OneDrive folder path')
  await target.fill('/Another test notebook')
  const change = 'Disable Agent access & save'
  page.once('dialog', dialog => dialog.dismiss())
  await activate(change)
  await expect(page.getByText('No changes were made.', { exact: true })).toBeVisible()
  expect((await listTools()).status()).toBe(200)
  page.once('dialog', dialog => dialog.accept())
  await activate(change)
  await expect(enable).toBeDisabled()
  expect((await listTools()).status()).toBe(401)

  // Reopen the fixture folder and confirm disconnect uses the same safety gate.
  await target.fill('/Rivolo')
  await activate('Save')
  await activate('Pull from OneDrive')
  await expect(enable).toBeEnabled()
  await activate('Enable for OneDrive')
  const disconnect = 'Disconnect OneDrive (& disable Agent Access)'
  await expect(page.getByRole('button', { name: disconnect, exact: true })).toBeVisible()
  page.once('dialog', dialog => dialog.accept())
  await activate(disconnect)
  await expect(page.getByRole('button', { name: 'OneDrive Not connected', exact: true })).toBeVisible()
  const snapshot = await (await page.request.get('/__fixtures/snapshot')).json()
  expect(snapshot.profiles).toHaveLength(1)
  expect(snapshot.profiles[0]).toMatchObject({ revoked_at: expect.any(String), encrypted_refresh_token: '' })

  await page.goto('/privacy')
  await expect(page.getByText(/Microsoft's Files.ReadWrite.All permission/)).toBeVisible()
  await page.goto('/settings')
  await activate('Rivolo')
  await page.goto('/privacy')
  await expect(page.getByText(/Microsoft's Files.ReadWrite.All permission/)).toBeVisible()
  await checkWidth()
})
