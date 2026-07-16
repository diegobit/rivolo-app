import { describe, expect, it, vi } from 'vitest'
import { parseMarkdown } from '../lib/markdown.js'
import {
  createDropboxNotesAdapter,
  type AuthorizedDropboxFetch,
} from '../../mcp/providers/dropboxNotes.js'

const PATH = '/inbox.md'
const MODIFIED_AT = '2026-07-16T12:00:00.000Z'

const metadata = (rev: string, overrides: Record<string, unknown> = {}) => ({
  rev,
  server_modified: MODIFIED_AT,
  size: 120,
  content_hash: `hash-${rev}`,
  ...overrides,
})

const json = (body: unknown, init: ResponseInit = {}) => Response.json(body, init)

const download = (body: string, rev: string) =>
  new Response(body, {
    headers: {
      'Dropbox-API-Result': JSON.stringify(metadata(rev, { size: body.length })),
    },
  })

const conflict = () =>
  json({ error_summary: 'path/conflict/file/..' }, { status: 409 })

const makeFetch = (...responses: Response[]) =>
  vi.fn<AuthorizedDropboxFetch>().mockImplementation(async () => {
    const response = responses.shift()
    if (!response) {
      throw new Error('Unexpected Dropbox request.')
    }
    return response
  })

const call = (
  fetchMock: ReturnType<typeof makeFetch>,
  index: number,
) => {
  const request = fetchMock.mock.calls[index]
  if (!request) {
    throw new Error(`Missing fetch call ${index}.`)
  }
  return request
}

describe('createDropboxNotesAdapter', () => {
  it('loads provider metadata and sorted Rivolo days from Dropbox', async () => {
    const markdown = [
      '<!-- day:2026-07-15 -->',
      'Jul 15, 2026',
      '------------',
      '',
      'Older',
      '',
      '<!-- day:2026-07-16 -->',
      'Jul 16, 2026',
      '------------',
      '',
      'Newer',
    ].join('\n')
    const fetchMock = makeFetch(download(markdown, 'rev-downloaded'))
    const adapter = createDropboxNotesAdapter({
      authorizedFetch: fetchMock,
      path: PATH,
    })

    const snapshot = await adapter.loadNotes()

    expect(snapshot.source).toEqual({
      provider: 'dropbox',
      path: PATH,
      rev: 'rev-downloaded',
      sizeBytes: markdown.length,
      modifiedAt: MODIFIED_AT,
      contentHash: 'hash-rev-downloaded',
    })
    expect(snapshot.warnings).toEqual([])
    expect(snapshot.days.map((day) => day.dayId)).toEqual([
      '2026-07-16',
      '2026-07-15',
    ])
    expect(snapshot.days[0]).toMatchObject({
      contentMd: 'Newer',
      createdAt: Date.parse(MODIFIED_AT),
      updatedAt: Date.parse(MODIFIED_AT),
    })
    expect(call(fetchMock, 0)[0]).toBe(
      'https://content.dropboxapi.com/2/files/download',
    )
    expect(
      JSON.parse(
        String(new Headers(call(fetchMock, 0)[1]?.headers).get('Dropbox-API-Arg')),
      ),
    ).toEqual({ path: PATH })
  })

  it('appends by default and uploads with revision CAS', async () => {
    const original = [
      '<!-- day:2026-07-16 -->',
      'Jul 16, 2026',
      '------------',
      '',
      'Existing note',
    ].join('\n')
    const fetchMock = makeFetch(
      download(original, 'rev-1'),
      json(metadata('rev-2', { size: 150 })),
    )
    const adapter = createDropboxNotesAdapter({
      authorizedFetch: fetchMock,
      path: PATH,
      now: () => 200,
    })

    const result = await adapter.addToDay({
      day_id: '2026-07-16',
      content_md: 'New note',
      operation_id: 'operation-1',
    })

    expect(result).toMatchObject({
      source: { provider: 'dropbox', path: PATH, rev: 'rev-2' },
      created: false,
      position: 'append',
      operation_id: 'operation-1',
      conflictRetries: 0,
      day: {
        dayId: '2026-07-16',
        contentMd: 'Existing note\n\nNew note',
        updatedAt: 200,
      },
    })

    const [, uploadInit] = call(fetchMock, 1)
    expect(JSON.parse(String(new Headers(uploadInit?.headers).get('Dropbox-API-Arg')))).toEqual({
      path: PATH,
      mode: {
        '.tag': 'update',
        update: 'rev-1',
      },
      autorename: false,
      mute: false,
    })
    expect(uploadInit?.body).toBeTypeOf('string')
    expect(parseMarkdown(String(uploadInit?.body)).days[0]?.contentMd).toBe(
      'Existing note\n\nNew note',
    )
  })

  it('prepends to a newly created day without overwriting other days', async () => {
    const original = [
      '<!-- day:2026-07-16 -->',
      'Jul 16, 2026',
      '------------',
      '',
      'Existing note',
    ].join('\n')
    const fetchMock = makeFetch(
      download(original, 'rev-1'),
      json(metadata('rev-2')),
    )
    const adapter = createDropboxNotesAdapter({
      authorizedFetch: fetchMock,
      path: PATH,
      now: () => 200,
    })

    const result = await adapter.addToDay({
      day_id: '2026-07-17',
      content_md: 'First note',
      position: 'prepend',
      operation_id: 'operation-2',
    })

    expect(result).toMatchObject({
      created: true,
      position: 'prepend',
      operation_id: 'operation-2',
      day: {
        dayId: '2026-07-17',
        contentMd: 'First note',
        createdAt: 200,
      },
    })
    const uploaded = parseMarkdown(String(call(fetchMock, 1)[1]?.body))
    expect(uploaded.days.map((day) => day.dayId)).toEqual([
      '2026-07-17',
      '2026-07-16',
    ])
    expect(uploaded.days[1]?.contentMd).toBe('Existing note')
  })

  it('refetches and reapplies the mutation after a Dropbox path conflict', async () => {
    const beforeConflict = [
      '<!-- day:2026-07-16 -->',
      'Jul 16, 2026',
      '------------',
      '',
      'Initial',
    ].join('\n')
    const afterConflict = [
      '<!-- day:2026-07-16 -->',
      'Jul 16, 2026',
      '------------',
      '',
      'Initial',
      '',
      'Concurrent edit',
    ].join('\n')
    const fetchMock = makeFetch(
      download(beforeConflict, 'rev-1'),
      conflict(),
      download(afterConflict, 'rev-2'),
      json(metadata('rev-3')),
    )
    const adapter = createDropboxNotesAdapter({
      authorizedFetch: fetchMock,
      path: PATH,
      now: () => 200,
    })

    const result = await adapter.addToDay({
      day_id: '2026-07-16',
      content_md: 'Agent note',
      operation_id: 'operation-replay',
    })

    expect(result).toMatchObject({
      source: { rev: 'rev-3' },
      operation_id: 'operation-replay',
      conflictRetries: 1,
    })
    const replayArg = JSON.parse(
      String(new Headers(call(fetchMock, 3)[1]?.headers).get('Dropbox-API-Arg')),
    )
    expect(replayArg.mode).toEqual({ '.tag': 'update', update: 'rev-2' })
    expect(parseMarkdown(String(call(fetchMock, 3)[1]?.body)).days[0]?.contentMd).toBe(
      'Initial\n\nConcurrent edit\n\nAgent note',
    )
  })

  it('fails clearly after the bounded conflict retries are exhausted', async () => {
    const original = [
      '<!-- day:2026-07-16 -->',
      'Jul 16, 2026',
      '------------',
      '',
      'Existing note',
    ].join('\n')
    const fetchMock = makeFetch(
      download(original, 'rev-1'),
      conflict(),
      download(original, 'rev-2'),
      conflict(),
    )
    const adapter = createDropboxNotesAdapter({
      authorizedFetch: fetchMock,
      path: PATH,
      maxConflictRetries: 1,
    })

    await expect(
      adapter.addToDay({
        day_id: '2026-07-16',
        content_md: 'Private agent note',
        operation_id: 'operation-exhausted',
      }),
    ).rejects.toThrow('Dropbox notes changed repeatedly; retry the operation.')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('does not upload a file with no Rivolo day markers', async () => {
    const fetchMock = makeFetch(download('Unmarked private content', 'rev-1'))
    const adapter = createDropboxNotesAdapter({
      authorizedFetch: fetchMock,
      path: PATH,
    })

    await expect(
      adapter.addToDay({
        day_id: '2026-07-16',
        content_md: 'Agent note',
        operation_id: 'operation-no-markers',
      }),
    ).rejects.toThrow(
      'Dropbox notes cannot be updated safely because their day markers are invalid.',
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not upload a file with duplicate Rivolo day markers', async () => {
    const duplicateDays = [
      '<!-- day:2026-07-16 -->',
      'Jul 16, 2026',
      '------------',
      '',
      'First block',
      '',
      '<!-- day:2026-07-16 -->',
      'Jul 16, 2026',
      '------------',
      '',
      'Second block',
    ].join('\n')
    const fetchMock = makeFetch(download(duplicateDays, 'rev-1'))
    const adapter = createDropboxNotesAdapter({
      authorizedFetch: fetchMock,
      path: PATH,
    })

    await expect(
      adapter.addToDay({
        day_id: '2026-07-16',
        content_md: 'Agent note',
        operation_id: 'operation-duplicate',
      }),
    ).rejects.toThrow(
      'Dropbox notes cannot be updated safely because their day markers are invalid.',
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not upload a file with content before the first day marker', async () => {
    const source = [
      'Private preamble',
      '',
      '<!-- day:2026-07-16 -->',
      'Jul 16, 2026',
      '------------',
      '',
      'Existing note',
    ].join('\n')
    const fetchMock = makeFetch(download(source, 'rev-1'))
    const adapter = createDropboxNotesAdapter({
      authorizedFetch: fetchMock,
      path: PATH,
    })

    await expect(
      adapter.addToDay({
        day_id: '2026-07-16',
        content_md: 'Agent note',
        operation_id: 'operation-preamble',
      }),
    ).rejects.toThrow(
      'Dropbox notes cannot be updated safely because their day markers are invalid.',
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not include Dropbox response content in request errors', async () => {
    const fetchMock = makeFetch(
      json({ access_token: 'secret-token', notes: 'private content' }, { status: 500 }),
    )
    const adapter = createDropboxNotesAdapter({
      authorizedFetch: fetchMock,
      path: PATH,
    })

    const error = await adapter.loadNotes().catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe(
      'Dropbox download request failed with status 500.',
    )
    expect((error as Error).message).not.toMatch(/secret-token|private content/)
  })

  it('sanitizes authorized-fetch failures', async () => {
    const authorizedFetch = vi
      .fn<AuthorizedDropboxFetch>()
      .mockRejectedValue(new Error('Authorization: Bearer secret-token'))
    const adapter = createDropboxNotesAdapter({
      authorizedFetch,
      path: PATH,
    })

    const error = await adapter.loadNotes().catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Dropbox download request failed.')
    expect((error as Error).message).not.toContain('secret-token')
  })
})
