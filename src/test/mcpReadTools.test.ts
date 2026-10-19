import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { afterEach, describe, expect, it } from 'vitest'
import { registerReadTools, type LoadNotes, type NotesSnapshot } from '../../mcp/readTools.js'

const snapshot: NotesSnapshot = {
  source: {
    filePath: '/notes/inbox.md',
    sizeBytes: 42,
    modifiedAt: '2026-07-16T12:00:00.000Z',
  },
  warnings: [],
  days: [
    {
      dayId: '2026-07-16',
      humanTitle: 'Jul 16, 2026',
      contentMd: 'Hello #rivolo',
      createdAt: Date.parse('2026-07-16T12:00:00.000Z'),
      updatedAt: Date.parse('2026-07-16T12:00:00.000Z'),
    },
  ],
}

describe('registerReadTools', () => {
  const openServers: McpServer[] = []
  const openClients: Client[] = []

  afterEach(async () => {
    await Promise.all([...openClients.map((client) => client.close()), ...openServers.map((server) => server.close())])
    openClients.length = 0
    openServers.length = 0
  })

  const connect = async (loadNotes: LoadNotes = async () => snapshot) => {
    const server = new McpServer({ name: 'test-rivolo-notes', version: '0.0.0' })
    const client = new Client({ name: 'test-client', version: '0.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    registerReadTools(server, loadNotes)
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    openServers.push(server)
    openClients.push(client)

    return client
  }

  it('registers the existing read tool contract against an injected notes loader', async () => {
    const client = await connect()
    const tools = await client.listTools()

    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'get_system_prompt',
      'list_days',
      'get_day',
      'search_notes',
      'get_recent_days',
      'list_open_todos',
      'list_tags',
      'list_mentions',
    ])

    const result = await client.callTool({
      name: 'list_days',
      arguments: { include_content: true },
    })
    const content = result.content[0]

    expect(content).toMatchObject({ type: 'text' })
    if (content.type !== 'text') {
      throw new Error('Expected text tool result.')
    }

    expect(JSON.parse(content.text)).toEqual({
      source: snapshot.source,
      warnings: [],
      count: 1,
      total_matches: 1,
      has_more: false,
      days: [
        {
          day_id: '2026-07-16',
          human_title: 'Jul 16, 2026',
          content_chars: 13,
          is_empty: false,
          updated_at: '2026-07-16T12:00:00.000Z',
          content_md: 'Hello #rivolo',
          content_truncated: false,
        },
      ],
    })
  })

  const contractNotes: NotesSnapshot = {
    ...snapshot,
    warnings: ['fixture warning'],
    days: [
      { ...snapshot.days[0], dayId: '2026-07-18', contentMd: '' },
      { ...snapshot.days[0], dayId: '2026-07-17', contentMd: '- [ ] Call @alice #work\n- [x] Done' },
      { ...snapshot.days[0], dayId: '2026-07-16', contentMd: 'Older #work @bob' },
    ],
  }

  it.each([
    { name: 'list_days', arguments: { limit: 1, include_content: true, max_content_chars: 5 }, expected: { count: 1, total_matches: 2, has_more: true, days: [{ day_id: '2026-07-17', content_md: '- [ ]', content_truncated: true }] } },
    { name: 'list_days', arguments: { before_day_id: '2026-07-17', include_content: false }, expected: { count: 1, total_matches: 1, has_more: false, days: [{ day_id: '2026-07-16', content_chars: 16 }] } },
    { name: 'get_recent_days', arguments: { limit: 1 }, expected: { count: 1, days: [{ day_id: '2026-07-17' }] } },
    { name: 'search_notes', arguments: { query: 'Call', date_from: '2026-07-17' }, expected: { count: 1, results: [{ day: { day_id: '2026-07-17' }, block_kind: 'line', matched_blocks: ['- [ ] Call @alice #work'] }] } },
    { name: 'list_open_todos', arguments: {}, expected: { count: 1, total_matches: 1, todos: [{ day_id: '2026-07-17', line_number: 1, text: '- [ ] Call @alice #work' }] } },
    { name: 'list_tags', arguments: {}, expected: { count: 1, total_matches: 1, tags: [{ token: '#work', count: 2, days: ['2026-07-17', '2026-07-16'] }] } },
    { name: 'list_mentions', arguments: { limit: 1 }, expected: { count: 1, total_matches: 2, mentions: [{ token: '@alice', count: 1, days: ['2026-07-17'] }] } },
    { name: 'get_day', arguments: { day_id: '2026-07-15' }, expected: { found: false, day_id: '2026-07-15' } },
  ])('serializes $name with independent protocol expectations', async ({ name, arguments: args, expected }) => {
    const client = await connect(async () => contractNotes)
    const result = await client.callTool({ name, arguments: args })
    const content = result.content[0]
    if (content.type !== 'text') throw new Error('Expected text tool result.')
    const payload = JSON.parse(content.text)
    expect(payload).toMatchObject({ source: snapshot.source, warnings: ['fixture warning'], ...expected })
    if (name === 'get_recent_days' || (name === 'list_days' && args.include_content === false)) {
      expect(payload.days[0]).not.toHaveProperty('content_md')
    }
  })

  it('returns a range error through the protocol without loading notes', async () => {
    let loads = 0
    const client = await connect(async () => { loads++; return snapshot })
    const result = await client.callTool({ name: 'list_days', arguments: { date_from: '2026-07-17', date_to: '2026-07-16' } })
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'date_from must be earlier than or equal to date_to.' }])
    expect(loads).toBe(0)
  })

})
