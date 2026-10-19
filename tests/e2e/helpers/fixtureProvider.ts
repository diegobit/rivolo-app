import { createServer, type ServerResponse } from 'node:http'
import { expect } from 'playwright/test'

type PendingRequest = {
  response: ServerResponse
  body: { messages: { content: string }[] }
}

export type FixtureProviderRequest = {
  body: PendingRequest['body']
  chunk: (content: string) => void
  finish: () => void
}

export async function createFixtureProvider() {
  const pending: PendingRequest[] = []
  const server = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Headers', '*')
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end()
      return
    }

    let raw = ''
    for await (const chunk of request) raw += chunk.toString()
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    response.flushHeaders()
    pending.push({ response, body: JSON.parse(raw) as PendingRequest['body'] })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }

  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    async request(): Promise<FixtureProviderRequest> {
      await expect.poll(() => pending.length).toBeGreaterThan(0)
      const captured = pending.shift()!
      return {
        body: captured.body,
        chunk(content) {
          captured.response.write(
            `data: ${JSON.stringify({
              id: 'qa-response',
              object: 'chat.completion.chunk',
              created: 1,
              model: 'qa-model',
              choices: [{ index: 0, delta: { content }, finish_reason: null }],
            })}\n\n`,
          )
        },
        finish() {
          captured.response.end(
            `data: ${JSON.stringify({
              id: 'qa-response',
              object: 'chat.completion.chunk',
              created: 1,
              model: 'qa-model',
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            })}\n\ndata: [DONE]\n\n`,
          )
        },
      }
    },
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
