import { describe, expect, it, vi } from 'vitest'
import {
  createGoogleDriveNotesSource,
  type GoogleDriveNotesTarget,
} from '../../mcp/googleDriveNotesSource.js'

const json = (body: unknown, init: ResponseInit = {}) => Response.json(body, init)

const target: GoogleDriveNotesTarget = {
  fileId: 'file-1',
  fileName: 'inbox.md',
  folderId: 'folder-1',
}

const metadata = (
  version: string,
  headRevisionId: string,
  modifiedTime = '2026-07-16T12:00:00.000Z',
) => ({
  id: target.fileId,
  name: target.fileName,
  mimeType: 'text/markdown',
  size: '123',
  version,
  headRevisionId,
  modifiedTime,
  parents: [target.folderId],
  capabilities: {
    canDownload: true,
    canEdit: true,
    canModifyContent: true,
  },
})

const day = (dayId: string, title: string, content: string) =>
  [`<!-- day:${dayId} -->`, title, '-'.repeat(title.length), '', content].join('\n')

const expectRequest = (
  fetchMock: ReturnType<typeof vi.fn>,
  index: number,
  pattern: string,
  method?: string,
) => {
  const [url, init] = fetchMock.mock.calls[index] ?? []
  expect(String(url)).toContain(pattern)
  if (method) {
    expect(init).toMatchObject({ method })
  }
  return init as RequestInit | undefined
}

describe('createGoogleDriveNotesSource', () => {
  it('reads the known Drive file into a sorted notes snapshot', async () => {
    const content = [
      day('2026-07-15', 'Jul 15, 2026', 'older'),
      day('2026-07-16', 'Jul 16, 2026', 'newer'),
    ].join('\n\n')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(metadata('7', 'rev-7')))
      .mockResolvedValueOnce(new Response(content))

    const source = createGoogleDriveNotesSource(fetchMock, target)
    const snapshot = await source.read()

    expect(snapshot.source).toEqual({
      provider: 'google-drive',
      fileId: 'file-1',
      fileName: 'inbox.md',
      folderId: 'folder-1',
      version: '7',
      headRevisionId: 'rev-7',
      modifiedAt: '2026-07-16T12:00:00.000Z',
      sizeBytes: 123,
    })
    expect(snapshot.warnings).toEqual([])
    expect(snapshot.days.map((candidate) => candidate.dayId)).toEqual([
      '2026-07-16',
      '2026-07-15',
    ])
    expect(snapshot.days[0]?.contentMd).toBe('newer')
    expectRequest(fetchMock, 0, '/files/file-1?fields=')
    expectRequest(fetchMock, 1, '/files/file-1?alt=media')
  })

  it('appends to an existing day and uploads the whole Markdown file', async () => {
    const content = day('2026-07-16', 'Jul 16, 2026', 'existing')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(metadata('7', 'rev-7')))
      .mockResolvedValueOnce(new Response(content))
      .mockResolvedValueOnce(json(metadata('8', 'rev-8')))
      .mockResolvedValueOnce(json(metadata('8', 'rev-8')))
      .mockResolvedValueOnce(
        json({
          revisions: [
            { id: 'rev-7', modifiedTime: '2026-07-16T12:00:00.000Z' },
            { id: 'rev-8', modifiedTime: '2026-07-16T12:00:01.000Z' },
          ],
        }),
      )

    const source = createGoogleDriveNotesSource(fetchMock, target)
    const result = await source.addToDay({
      day_id: '2026-07-16',
      content_md: 'agent addition',
      operation_id: 'operation-1',
    })

    expect(result).toMatchObject({
      status: 'written',
      recovered: false,
      created: false,
      position: 'append',
      operation_id: 'operation-1',
      day: {
        contentMd: 'existing\n\nagent addition',
      },
      source: {
        version: '8',
        headRevisionId: 'rev-8',
      },
    })
    const upload = expectRequest(fetchMock, 2, '/upload/drive/v3/files/file-1?', 'PATCH')
    expect(upload?.body).toContain('existing\n\nagent addition')
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('prepends to an existing day and creates a missing day', async () => {
    const content = day('2026-07-15', 'Jul 15, 2026', 'existing')
    const prependFetch = vi
      .fn()
      .mockResolvedValueOnce(json(metadata('1', 'rev-1')))
      .mockResolvedValueOnce(new Response(content))
      .mockResolvedValueOnce(json(metadata('2', 'rev-2')))
      .mockResolvedValueOnce(json(metadata('2', 'rev-2')))
      .mockResolvedValueOnce(
        json({
          revisions: [
            { id: 'rev-1', modifiedTime: '2026-07-16T12:00:00.000Z' },
            { id: 'rev-2', modifiedTime: '2026-07-16T12:00:01.000Z' },
          ],
        }),
      )
    const createFetch = vi
      .fn()
      .mockResolvedValueOnce(json(metadata('2', 'rev-2')))
      .mockResolvedValueOnce(new Response(content))
      .mockResolvedValueOnce(json(metadata('3', 'rev-3')))
      .mockResolvedValueOnce(json(metadata('3', 'rev-3')))
      .mockResolvedValueOnce(
        json({
          revisions: [
            { id: 'rev-2', modifiedTime: '2026-07-16T12:00:00.000Z' },
            { id: 'rev-3', modifiedTime: '2026-07-16T12:00:01.000Z' },
          ],
        }),
      )

    const prepended = await createGoogleDriveNotesSource(prependFetch, target).addToDay({
      day_id: '2026-07-15',
      content_md: 'first',
      position: 'prepend',
      operation_id: 'operation-prepend',
    })
    const created = await createGoogleDriveNotesSource(createFetch, target).addToDay({
      day_id: '2026-07-16',
      content_md: 'new day',
      operation_id: 'operation-create',
    })

    expect(prepended).toMatchObject({
      created: false,
      position: 'prepend',
      day: { contentMd: 'first\n\nexisting' },
    })
    expect(created).toMatchObject({
      created: true,
      position: 'append',
      day: { dayId: '2026-07-16', contentMd: 'new day' },
    })
    expect(String(prependFetch.mock.calls[2]?.[1]?.body)).toContain('first\n\nexisting')
    expect(String(createFetch.mock.calls[2]?.[1]?.body)).toMatch(
      /<!-- day:2026-07-16 -->[\s\S]*new day[\s\S]*<!-- day:2026-07-15 -->/,
    )
  })

  it('replays the addition once against an identifiable concurrent revision', async () => {
    const baseContent = day('2026-07-16', 'Jul 16, 2026', 'base')
    const concurrentContent = day(
      '2026-07-16',
      'Jul 16, 2026',
      'base\n\nconcurrent browser addition',
    )
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(metadata('10', 'rev-10')))
      .mockResolvedValueOnce(new Response(baseContent))
      .mockResolvedValueOnce(json(metadata('12', 'rev-12')))
      .mockResolvedValueOnce(json(metadata('12', 'rev-12')))
      .mockResolvedValueOnce(
        json({
          revisions: [
            { id: 'rev-10', modifiedTime: '2026-07-16T12:00:00.000Z' },
            { id: 'rev-11', modifiedTime: '2026-07-16T12:00:01.000Z' },
            { id: 'rev-12', modifiedTime: '2026-07-16T12:00:02.000Z' },
          ],
        }),
      )
      .mockResolvedValueOnce(new Response(concurrentContent))
      .mockResolvedValueOnce(json(metadata('13', 'rev-13')))

    const result = await createGoogleDriveNotesSource(fetchMock, target).addToDay({
      day_id: '2026-07-16',
      content_md: 'agent addition',
      operation_id: 'operation-recovery',
    })

    expect(result).toMatchObject({
      status: 'attention',
      recovered: true,
      operation_id: 'operation-recovery',
      day: {
        contentMd: 'base\n\nconcurrent browser addition\n\nagent addition',
      },
      source: {
        version: '13',
        headRevisionId: 'rev-13',
      },
    })
    expect(result.attention).toContain('replayed once')
    expectRequest(fetchMock, 4, '/files/file-1/revisions?')
    expectRequest(fetchMock, 5, '/files/file-1/revisions/rev-11?alt=media')
    const recoveryUpload = expectRequest(fetchMock, 6, '/upload/drive/v3/files/file-1?', 'PATCH')
    expect(recoveryUpload?.body).toContain(
      'base\n\nconcurrent browser addition\n\nagent addition',
    )
  })

  it('returns attention without another overwrite when recovery is inconclusive', async () => {
    const content = day('2026-07-16', 'Jul 16, 2026', 'base')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(metadata('10', 'rev-10')))
      .mockResolvedValueOnce(new Response(content))
      .mockResolvedValueOnce(json(metadata('12', 'rev-12')))
      .mockResolvedValueOnce(json(metadata('12', 'rev-12')))
      .mockResolvedValueOnce(
        json({
          revisions: [
            { id: 'rev-10', modifiedTime: '2026-07-16T12:00:00.000Z' },
            { id: 'rev-12' },
          ],
        }),
      )

    const result = await createGoogleDriveNotesSource(fetchMock, target).addToDay({
      day_id: '2026-07-16',
      content_md: 'agent addition',
      operation_id: 'operation-attention',
    })

    expect(result).toMatchObject({
      status: 'attention',
      recovered: false,
      operation_id: 'operation-attention',
    })
    expect(result.attention).toContain('could not be identified safely')
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(
      fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH'),
    ).toHaveLength(1)
  })

  it.each([
    {
      name: 'has no Rivolo day markers',
      content: '# Ordinary Markdown\n\nThis must not be replaced.',
      message: 'No day markers found.',
    },
    {
      name: 'has duplicate Rivolo day markers',
      content: [
        day('2026-07-16', 'Jul 16, 2026', 'first copy'),
        day('2026-07-16', 'Jul 16, 2026', 'second copy'),
      ].join('\n\n'),
      message: 'Duplicate day marker for 2026-07-16',
    },
    {
      name: 'has an invalid calendar day marker',
      content: day('2026-02-30', 'Feb 30, 2026', 'invalid date block'),
      message: 'Invalid day marker for 2026-02-30',
    },
  ])('does not upload when the source $name', async ({ content, message }) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(metadata('7', 'rev-7')))
      .mockResolvedValueOnce(new Response(content))

    await expect(
      createGoogleDriveNotesSource(fetchMock, target).addToDay({
        day_id: '2026-07-16',
        content_md: 'agent addition',
        operation_id: 'operation-unsafe',
      }),
    ).rejects.toThrow(message)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(
      fetchMock.mock.calls.some(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
      ),
    ).toBe(false)
  })

  it('does not upload a recovery when the concurrent revision is unsafe to re-export', async () => {
    const baseContent = day('2026-07-16', 'Jul 16, 2026', 'base')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(metadata('10', 'rev-10')))
      .mockResolvedValueOnce(new Response(baseContent))
      .mockResolvedValueOnce(json(metadata('12', 'rev-12')))
      .mockResolvedValueOnce(json(metadata('12', 'rev-12')))
      .mockResolvedValueOnce(
        json({
          revisions: [
            { id: 'rev-10', modifiedTime: '2026-07-16T12:00:00.000Z' },
            { id: 'rev-11', modifiedTime: '2026-07-16T12:00:01.000Z' },
            { id: 'rev-12', modifiedTime: '2026-07-16T12:00:02.000Z' },
          ],
        }),
      )
      .mockResolvedValueOnce(
        new Response('# Concurrent ordinary Markdown\n\nMust not be replaced.'),
      )

    await expect(
      createGoogleDriveNotesSource(fetchMock, target).addToDay({
        day_id: '2026-07-16',
        content_md: 'agent addition',
        operation_id: 'operation-unsafe-recovery',
      }),
    ).rejects.toThrow('No day markers found.')

    expect(
      fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH'),
    ).toHaveLength(1)
  })
})
