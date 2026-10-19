import { expect, type Page } from 'playwright/test'

// Read the actual UI download, independently of CodeMirror's virtualized DOM.
export async function downloadArchive(page: Page) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: /^Export .*\.md$/ }).click()
  const download = await pending
  const stream = await download.createReadStream()
  expect(stream).not.toBeNull()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}
