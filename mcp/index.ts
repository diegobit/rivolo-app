#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { env, exit, stderr } from 'node:process'
import { loadNotesFile } from './notesFile.js'
import { registerReadTools } from './readTools.js'

const SERVER_VERSION = '0.1.0'

const getNotesFilePath = () => {
  const filePath = env.RIVOLO_NOTES_FILE?.trim()
  if (!filePath) {
    throw new Error('Missing RIVOLO_NOTES_FILE. Set it to the local Rivolo markdown export file.')
  }
  return filePath
}

const main = async () => {
  getNotesFilePath()

  const server = new McpServer({
    name: 'rivolo-notes',
    version: SERVER_VERSION,
  })

  registerReadTools(server, () => loadNotesFile(getNotesFilePath()))
  await server.connect(new StdioServerTransport())
}

main().catch((error: unknown) => {
  stderr.write(`${error instanceof Error ? error.message : 'Failed to start Rivolo MCP server.'}\n`)
  exit(1)
})
