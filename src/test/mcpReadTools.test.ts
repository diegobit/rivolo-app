import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { afterEach, describe, expect, it } from 'vitest'
import { registerReadTools, type NotesSnapshot } from '../../mcp/readTools.js'

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

  const connect = async () => {
    const server = new McpServer({ name: 'test-rivolo-notes', version: '0.0.0' })
    const client = new Client({ name: 'test-client', version: '0.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    registerReadTools(server, async () => snapshot)
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
})
