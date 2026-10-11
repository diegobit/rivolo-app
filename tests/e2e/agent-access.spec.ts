import { createHash } from 'node:crypto'
import { test, expect, type Page } from 'playwright/test'
import { connectDropbox } from './helpers/dropbox'

// External HTTP must reach the fixture routes rather than a service worker cache.
test.use({ serviceWorkers: 'block' })

async function connect(page: Page) {
  const revision = await connectDropbox(page)
  await page.getByText('Agent access', { exact: true }).click()
  await page.getByRole('button', { name: 'Enable for Dropbox', exact: true }).click()
  await expect(page.getByText('No access tokens yet.', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('rivolo.db.persisted-revision'))).not.toBe(revision)
  const cookies = await page.context().cookies()
  const provider = cookies.find(cookie => cookie.name === 'rivolo_dropbox_refresh')!
  const profile = cookies.find(cookie => cookie.name === 'rivolo_mcp_profile')!
  expect(provider).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/api/dropbox' })
  expect(profile).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/api/mcp' })
  expect(provider.value).not.toContain('fixture-provider-refresh')
  const snapshot = await (await page.request.get('/__fixtures/snapshot')).json()
  expect(profile.value).not.toContain(snapshot.profiles[0].profile_id)
  expect(await page.evaluate(() => document.cookie)).not.toContain('rivolo_mcp_profile')
}

async function authorization(page: Page, state: string) {
  const base = new URL(page.url()).origin
  const redirect = `http://127.0.0.1:${Number(new URL(base).port) + 1}/callback`
  const registered = await page.request.post('/api/mcp/oauth/register', { data: { client_name: 'Browser agent', redirect_uris: [redirect], token_endpoint_auth_method: 'none' } })
  expect(registered.status()).toBe(201)
  const { client_id: clientId } = await registered.json()
  const verifier = 'browser-verifier-with-enough-entropy-1234567890'
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const params = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, state, scope: 'notes:read notes:write', code_challenge: challenge, code_challenge_method: 'S256', resource: `${base}/mcp` })
  await page.goto(`/api/mcp/oauth/authorize?${params}`)
  await expect(page.getByRole('heading', { name: 'Allow Browser agent?' })).toBeVisible()
  await expect(page.getByText('fixture@example.test', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  return { clientId, verifier, redirect, base }
}

async function bearerStatus(page: Page, token: string) {
  const response = await page.request.post('/mcp', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' }, data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
  return response.status()
}

test('J8: create, dismiss, reload, revoke and disable Agent access through actual APIs', async ({ page }) => {
  await connect(page)
  const origin = new URL(page.url()).origin
  expect((await page.request.post('/api/mcp/tokens', { headers: { Origin: origin }, data: { name: 'Missing CSRF' } })).status()).toBe(403)
  expect((await page.request.post('/api/mcp/tokens', { headers: { Origin: 'https://wrong.example', 'X-Requested-With': 'XmlHttpRequest' }, data: { name: 'Wrong origin' } })).status()).toBe(403)
  await page.getByLabel('Token name', { exact: true }).fill('Browser agent token')
  await page.getByRole('button', { name: 'Create token', exact: true }).click()
  const token = await page.getByLabel('New access token', { exact: true }).inputValue()
  expect(token).toMatch(/^rvl_/)
  expect(await bearerStatus(page, token)).toBe(200)
  const snapshot = await (await page.request.get('/__fixtures/snapshot')).json()
  expect(snapshot.tokens[0].token_hash).toBe(createHash('sha256').update(token).digest('hex'))
  expect(JSON.stringify(snapshot)).not.toContain(token)
  await page.getByRole('button', { name: 'I saved it — dismiss', exact: true }).click()
  await expect(page.getByLabel('New access token', { exact: true })).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: /^Dropbox / }).click()
  await page.getByText('Agent access', { exact: true }).click()
  await expect(page.getByText('Browser agent token', { exact: true })).toBeVisible()
  expect(await page.locator('body').textContent()).not.toContain(token)
  page.on('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Revoke', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Revoke', exact: true })).toHaveCount(0)
  expect(await bearerStatus(page, token)).toBe(401)
  await page.getByRole('button', { name: 'Disable Agent access', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Enable for Dropbox', exact: true })).toBeVisible()
  const after = await (await page.request.get('/__fixtures/snapshot')).json()
  expect(after.profiles[0].revoked_at).toBeTruthy()
  expect(after.profiles[0].encrypted_refresh_token).toBe('')
  await page.getByRole('button', { name: 'Enable for Dropbox', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Create token', exact: true })).toBeVisible()
  expect(await bearerStatus(page, token)).toBe(401)
})

test('J8: allow consent navigates to the external callback, exchanges and rotates a real grant', async ({ page }) => {
  await connect(page)
  const { clientId, verifier, redirect, base } = await authorization(page, 'allow-state-🙂')
  await page.getByRole('button', { name: 'Allow', exact: true }).click()
  await expect(page).toHaveURL(/\/callback\?/, { timeout: 5000 })
  const callback = new URL(page.url())
  expect(callback.searchParams.get('state')).toBe('allow-state-🙂')
  expect(callback.searchParams.get('iss')).toBe(`${base}/api/mcp/oauth`)
  const code = callback.searchParams.get('code')!
  expect(code).toBeTruthy()
  const params = { grant_type: 'authorization_code', client_id: clientId, redirect_uri: redirect, code, code_verifier: verifier, resource: `${base}/mcp` }
  const exchange = await page.request.post(`${base}/api/mcp/oauth/token`, { form: params })
  expect(exchange.status()).toBe(200)
  const token = await exchange.json()
  expect(await bearerStatus(page, token.access_token)).toBe(200)
  expect((await page.request.post(`${base}/api/mcp/oauth/token`, { form: params })).status()).toBe(400)
  const rotated = await page.request.post(`${base}/api/mcp/oauth/token`, { form: { grant_type: 'refresh_token', refresh_token: token.refresh_token, client_id: clientId, resource: `${base}/mcp` } })
  expect(rotated.status()).toBe(200)
  const next = await rotated.json()
  expect(next.refresh_token).not.toBe(token.refresh_token)
  expect((await page.request.post(`${base}/api/mcp/oauth/revoke`, { form: { client_id: clientId, token: next.refresh_token } })).status()).toBe(200)
  expect(await bearerStatus(page, next.access_token)).toBe(401)
})

test('J8: cancel consent returns state and issuer without creating a code', async ({ page }) => {
  await connect(page)
  const { base } = await authorization(page, 'cancel-state')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page).toHaveURL(/\/callback\?/, { timeout: 5000 })
  const callback = new URL(page.url())
  expect(callback.searchParams.get('state')).toBe('cancel-state')
  expect(callback.searchParams.get('iss')).toBe(`${base}/api/mcp/oauth`)
  expect(callback.searchParams.get('error')).toBe('access_denied')
  expect(callback.searchParams.has('code')).toBe(false)
  const snapshot = await (await page.request.get(`${base}/__fixtures/snapshot`)).json()
  expect(snapshot.codes).toHaveLength(0)
  expect(snapshot.grants).toHaveLength(0)
})

for (const mode of ['missing', 'tampered'] as const) {
  test(`J8: ${mode} profile cookie cannot authorize an agent`, async ({ page }) => {
    await connect(page)
    await authorization(page, 'cookie-state')
    const url = page.url()
    const cookie = (await page.context().cookies()).find(value => value.name === 'rivolo_mcp_profile')!
    await page.context().clearCookies({ name: 'rivolo_mcp_profile' })
    if (mode === 'tampered') await page.context().addCookies([{ ...cookie, value: `${cookie.value}x` }])
    const response = await page.goto(url)
    expect(response!.status()).toBe(401)
    await expect(page.getByRole('heading', { name: 'Connection could not continue' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Allow', exact: true })).toHaveCount(0)
    const snapshot = await (await page.request.get('/__fixtures/snapshot')).json()
    expect(snapshot.codes).toHaveLength(0)
    expect(snapshot.grants).toHaveLength(0)
  })
}
