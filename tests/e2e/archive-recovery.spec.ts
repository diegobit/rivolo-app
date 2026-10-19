import { test, expect } from 'playwright/test'
import { downloadArchive } from './helpers/archive'
import { connectDropbox } from './helpers/dropbox'

// Route only the external cloud. Replacement, rollback snapshots and restore
// run through the actual UI, sync provider, SQLite WASM and IndexedDB.
test.use({ serviceWorkers: 'block' })

test('J3: reject malformed cloud replacement, replace valid notes, and restore the local backup', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'canShare', { value: () => false }))
  await page.goto('/settings')
  const local = '<!-- day:2024-01-03 -->\nJanuary 3\n---\n\nLocal café — keep exactly\n[ ] unsynced task\n'
  await page.locator('input[type="file"]').setInputFiles({ name: 'local.md', mimeType: 'text/markdown', buffer: Buffer.from(local) })
  await expect(page.getByText(/Imported 1 day/)).toBeVisible()
  const remote = { content: '<!-- day:2024-01-04 -->\nJanuary 4\n---\n\nCloud replacement\n', rev: 'cloud-rev-1' }
  await connectDropbox(page, remote)
  await page.getByRole('button', { name: 'Advanced', exact: true }).click()
  const before = await downloadArchive(page)
  expect(before).toContain('Local café — keep exactly\n[ ] unsynced task')
  await page.getByRole('button', { name: 'Pull from Dropbox', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Force pull (overwrite local)', exact: true })).toBeVisible()
  remote.content = 'Malformed cloud body without a day marker'
  remote.rev = 'cloud-rev-invalid'
  await page.getByRole('button', { name: 'Force pull (overwrite local)', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm force pull', exact: true }).click()
  await expect(page.getByText(/no (?:valid days|day markers)/i).first()).toBeVisible()
  expect(await downloadArchive(page)).toBe(before)
  remote.content = '<!-- day:2024-01-04 -->\nJanuary 4\n---\n\nCloud replacement\n'
  remote.rev = 'cloud-rev-2'
  await page.getByRole('button', { name: 'Force pull (overwrite local)', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm force pull', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Pulled and imported.' })).toBeVisible()
  const replaced = await downloadArchive(page)
  expect(replaced).toContain('Cloud replacement')
  expect(replaced).not.toContain('Local café')
  // Remount Data so its backup inventory comes from durable storage.
  await page.reload()
  await page.getByRole('button', { name: 'Local backups', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Restore', exact: true }).first()).toBeVisible()
  page.on('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Restore', exact: true }).first().click()
  await expect(page.getByRole('status').filter({ hasText: 'Backup restored.' })).toBeVisible()
  expect(await downloadArchive(page)).toBe(before)
  await page.reload()
  expect(await downloadArchive(page)).toBe(before)
})
