import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  registerWriteTools,
  type AddToDayWriter,
  type AddToDayWriterResult,
} from '../../mcp/writeTools.js'
import { MAX_NOTE_WRITE_CHARS } from '../lib/noteWrites.js'

const makeWriteResult = (
  dayId: string,
  position: 'append' | 'prepend' = 'append',
): AddToDayWriterResult => ({
  day: {
    dayId,
    humanTitle: 'Jul 16, 2026',
    contentMd: 'Added note',
    createdAt: 100,
    updatedAt: 100,
  },
  created: false,
  position,
  operation_id: 'operation-1',
})

const readTextResult = (result: Awaited<ReturnType<Client['callTool']>>) => {
  const content = result.content[0]
  expect(content).toMatchObject({ type: 'text' })
  if (content.type !== 'text') {
    throw new Error('Expected text tool result.')
  }
  return content.text
}

describe('registerWriteTools', () => {
  const openServers: McpServer[] = []
  const openClients: Client[] = []

  afterEach(async () => {
    vi.useRealTimers()
    await Promise.all([
      ...openClients.map((client) => client.close()),
      ...openServers.map((server) => server.close()),
    ])
    openClients.length = 0
    openServers.length = 0
  })

  const connect = async (
    writer: AddToDayWriter,
    profileTimeZone = 'Europe/Rome',
  ) => {
    const server = new McpServer({ name: 'test-rivolo-notes', version: '0.0.0' })
    const client = new Client({ name: 'test-client', version: '0.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    registerWriteTools(server, writer, profileTimeZone)
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    openServers.push(server)
    openClients.push(client)

    return client
  }

  it('registers exactly the two additive write tools with bounded schemas', async () => {
    const client = await connect(async (input) => makeWriteResult(input.day_id))
    const tools = await client.listTools()

    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'add_to_day',
      'add_to_today',
    ])

    for (const tool of tools.tools) {
      expect(tool.description).toContain('only adds content')
      expect(tool.description).toContain('never replaces or deletes')
      expect(tool.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
      })
      expect(tool.inputSchema).toMatchObject({
        type: 'object',
        properties: {
          content_md: {
            type: 'string',
            minLength: 1,
            maxLength: 20_000,
          },
          operation_id: {
            type: 'string',
            minLength: 8,
            maxLength: 128,
            pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$',
          },
          position: {
            type: 'string',
            enum: ['append', 'prepend'],
            default: 'append',
          },
        },
        additionalProperties: false,
      })
      expect(tool.annotations).not.toHaveProperty('idempotentHint')
    }

    expect(tools.tools[0]?.inputSchema).toMatchObject({
      properties: {
        day_id: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        },
      },
      required: ['day_id', 'content_md', 'operation_id'],
    })
    expect(tools.tools[1]?.inputSchema).toMatchObject({
      required: ['content_md', 'operation_id'],
    })
  })

  it('defaults add_to_day to append and forwards the validated input', async () => {
    const writer = vi.fn<
      AddToDayWriter<
        AddToDayWriterResult & {
          source: { provider: 'dropbox'; rev: string }
        }
      >
    >().mockImplementation(async (input) => ({
      ...makeWriteResult(input.day_id, input.position),
      source: { provider: 'dropbox', rev: 'rev-2' },
    }))
    const client = await connect(writer)

    const result = await client.callTool({
      name: 'add_to_day',
      arguments: {
        day_id: '2026-07-16',
        content_md: 'Added note',
        operation_id: 'operation-1',
      },
    })

    expect(writer).toHaveBeenCalledWith({
      day_id: '2026-07-16',
      content_md: 'Added note',
      operation_id: 'operation-1',
      position: 'append',
    })
    const payload = JSON.parse(readTextResult(result))
    expect(payload).toMatchObject({
      day_id: '2026-07-16',
      content_chars: 10,
      position: 'append',
      operation_id: 'operation-1',
      source: { provider: 'dropbox', rev: 'rev-2' },
    })
    expect(payload).not.toHaveProperty('day')
    expect(payload).not.toHaveProperty('contentMd')
  })

  it('forwards an explicit prepend position', async () => {
    const writer = vi.fn<AddToDayWriter>().mockImplementation(async (input) =>
      makeWriteResult(input.day_id, input.position),
    )
    const client = await connect(writer)

    await client.callTool({
      name: 'add_to_day',
      arguments: {
        day_id: '2026-07-16',
        content_md: 'Added note',
        operation_id: 'operation-1',
        position: 'prepend',
      },
    })

    expect(writer).toHaveBeenCalledWith(
      expect.objectContaining({ position: 'prepend' }),
    )
  })

  it.each([
    ['UTC', '2026-01-01T00:30:00.000Z', '2026-01-01'],
    ['America/Los_Angeles', '2026-01-01T00:30:00.000Z', '2025-12-31'],
    ['Pacific/Kiritimati', '2026-01-01T12:30:00.000Z', '2026-01-02'],
  ])('writes add_to_today to %s calendar day', async (timeZone, instant, dayId) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(instant))
    const writer = vi.fn<AddToDayWriter>().mockImplementation(async input =>
      makeWriteResult(input.day_id, input.position),
    )
    const client = await connect(writer, timeZone)
    const result = await client.callTool({
      name: 'add_to_today',
      arguments: { content_md: 'Added note', operation_id: 'operation-1' },
    })
    expect(writer).toHaveBeenCalledExactlyOnceWith({
      day_id: dayId, content_md: 'Added note', operation_id: 'operation-1', position: 'append',
    })
    const payload = JSON.parse(readTextResult(result))
    expect(payload).toMatchObject({ day_id: dayId, time_zone: timeZone, content_chars: 10 })
    expect(payload).not.toHaveProperty('day')
    expect(payload).not.toHaveProperty('contentMd')
  })

  it.each(['  ', 'Europe/Not-A-Zone'])('refuses invalid profile timezone %j before writing', async timeZone => {
    const writer = vi.fn<AddToDayWriter>()
    const client = await connect(writer, timeZone)
    const result = await client.callTool({
      name: 'add_to_today',
      arguments: { content_md: 'Added note', operation_id: 'operation-1' },
    })
    expect(result.isError).toBe(true)
    expect(readTextResult(result)).toMatch(/time zone/)
    expect(writer).not.toHaveBeenCalled()
  })

  it('returns writer errors without masking their message', async () => {
    const client = await connect(async () => {
      throw new Error('Provider write failed.')
    })

    const result = await client.callTool({
      name: 'add_to_day',
      arguments: {
        day_id: '2026-07-16',
        content_md: 'Added note',
        operation_id: 'operation-1',
      },
    })

    expect(result.isError).toBe(true)
    expect(readTextResult(result)).toBe('Provider write failed.')
  })

  it('rejects invalid dates, content, and operation IDs before calling the writer', async () => {
    const writer = vi.fn<AddToDayWriter>().mockImplementation(async (input) =>
      makeWriteResult(input.day_id),
    )
    const client = await connect(writer)

    const invalidDate = await client.callTool({
      name: 'add_to_day',
      arguments: {
        day_id: '2026-02-30',
        content_md: 'Added note',
        operation_id: 'operation-1',
      },
    })
    const oversizedContent = await client.callTool({
      name: 'add_to_today',
      arguments: {
        content_md: 'a'.repeat(MAX_NOTE_WRITE_CHARS + 1),
        operation_id: 'operation-2',
      },
    })
    const invalidOperationId = await client.callTool({
      name: 'add_to_day',
      arguments: {
        day_id: '2026-07-16',
        content_md: 'Added note',
        operation_id: 'bad id!!',
      },
    })

    expect(invalidDate.isError).toBe(true)
    expect(readTextResult(invalidDate)).toContain(
      'Use a valid calendar date in YYYY-MM-DD format.',
    )
    expect(oversizedContent.isError).toBe(true)
    expect(readTextResult(oversizedContent)).toContain(
      `content_md must be ${MAX_NOTE_WRITE_CHARS} characters or fewer.`,
    )
    expect(invalidOperationId.isError).toBe(true)
    expect(readTextResult(invalidOperationId)).toContain(
      'operation_id contains unsupported characters',
    )
    expect(writer).not.toHaveBeenCalled()
  })
})
