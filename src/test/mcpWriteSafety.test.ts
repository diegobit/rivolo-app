// @vitest-environment node
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { createGoogleDriveNotesSource } from '../../mcp/googleDriveNotesSource'
import {
  ProviderProfileRepository,
  type ProviderProfileInput,
} from '../../functions/_lib/providerProfiles'
import {
  McpPersonalTokenRepository,
  authenticateMcpBearer,
} from '../../functions/_lib/mcpPersonalTokens'

const target = { fileId: 'file-1', fileName: 'inbox.md' }
const markdown = (content: string) =>
  `<!-- day:2026-07-16 -->\nJul 16, 2026\n------------\n\n${content}`
const metadata = (version: number) => ({
  id: target.fileId,
  name: target.fileName,
  mimeType: 'text/markdown',
  version: String(version),
  headRevisionId: `rev-${version}`,
})

it('does not replay an addition onto a revision saved after its upload', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json(metadata(10)))
    .mockResolvedValueOnce(new Response(markdown('base')))
    .mockResolvedValueOnce(Response.json(metadata(11)))
    .mockResolvedValueOnce(Response.json(metadata(12)))
    .mockResolvedValueOnce(Response.json({
      revisions: [10, 11, 12].map(version => ({
        id: `rev-${version}`,
        modifiedTime: `2026-07-16T12:00:${version}.000Z`,
      })),
    }))
    .mockResolvedValueOnce(new Response(markdown('base\n\nagent addition\n\nsecond writer')))
    .mockResolvedValueOnce(Response.json(metadata(13)))
  const result = await createGoogleDriveNotesSource(fetchMock, target).addToDay({
    day_id: '2026-07-16',
    content_md: 'agent addition',
    operation_id: 'operation-review',
  })
  expect(result).toMatchObject({ status: 'attention', recovered: false })
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1)
})

// Run the actual UPSERT and revocation triggers, rather than a fake that
// duplicates their logic, so cross-browser target protection is exercised.
const createDatabase = () => {
  const sql = new DatabaseSync(':memory:')
  for (const name of readdirSync('migrations').filter(name => name.endsWith('.sql')).sort()) {
    sql.exec(readFileSync(`migrations/${name}`, 'utf8'))
  }
  const db = {
    prepare: (query: string) => ({
      bind: (...values: SQLInputValue[]) => ({
        first: async () => sql.prepare(query).get(...values) ?? null,
        run: async () => ({ meta: { changes: sql.prepare(query).run(...values).changes } }),
      }),
    }),
  } as unknown as D1Database
  return { sql, db }
}

it.each(['dropbox', 'google-drive'] as const)(
  '%s requires disabling access before retargeting and keeps old tokens revoked',
  async (provider) => {
    const { sql, db } = createDatabase()
    try {
      const env = { MCP_DB: db, MCP_PROVIDER_TOKEN_ENCRYPTION_KEY: 'review-test-secret' }
      const profiles = new ProviderProfileRepository(db, env.MCP_PROVIDER_TOKEN_ENCRYPTION_KEY)
      const base = {
        providerAccountId: 'account-1',
        timeZone: 'Europe/Rome',
        refreshToken: 'review-refresh-token',
      }
      const input: ProviderProfileInput = provider === 'dropbox'
        ? { ...base, provider, target: { path: '/inbox.md' } }
        : { ...base, provider, target }
      const nextInput: ProviderProfileInput = provider === 'dropbox'
        ? { ...base, provider, target: { path: '/private.md' } }
        : { ...base, provider, target: { ...target, fileId: 'private-file' } }
      const profile = await profiles.createOrUpdate(input)
      const token = await new McpPersonalTokenRepository(db).create(profile.profileId, 'First browser agent')
      const request = new Request('https://mcp.rivolo.app/mcp', {
        headers: { Authorization: `Bearer ${token.token}` },
      })

      await expect(profiles.createOrUpdate(nextInput)).rejects.toThrow('Disable Agent access')
      expect((await profiles.getMetadata(profile.profileId))?.target).toMatchObject(input.target)
      // Reconnecting to the same file remains harmless and keeps grants valid.
      await profiles.createOrUpdate({ ...input, refreshToken: 'refreshed-credential' })
      expect(await authenticateMcpBearer(request, env)).not.toBeNull()

      await profiles.revoke(profile.profileId)
      const retargeted = await profiles.createOrUpdate(nextInput)
      expect(retargeted.target).toMatchObject(nextInput.target)
      expect(await authenticateMcpBearer(request, env)).toBeNull()
    } finally {
      sql.close()
    }
  },
)

it.each(['', ' \n\t'])('writes the first note to an empty Google file (%j)', async (content) => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json(metadata(10)))
    .mockResolvedValueOnce(new Response(content))
    .mockResolvedValueOnce(Response.json(metadata(11)))
    .mockResolvedValueOnce(Response.json(metadata(11)))
    .mockResolvedValueOnce(Response.json({ revisions: [] }))
  const result = await createGoogleDriveNotesSource(fetchMock, target).addToDay({
    day_id: '2026-07-16',
    content_md: 'first note',
    operation_id: 'operation-empty',
  })
  expect(result).toMatchObject({
    status: 'written', created: true, day: { contentMd: 'first note' },
  })
})
