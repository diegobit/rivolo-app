import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { DAILY_ANALYST_SYSTEM_PROMPT } from '../src/lib/llm/systemPrompts.js'
import {
  filterDays,
  listMentionsFromDays,
  listOpenTodosFromDays,
  listTagsFromDays,
  searchDaysInMemory,
  type Day,
  type DayFilterOptions,
  type SearchFilter,
} from '../src/lib/notesCore.js'

const DEFAULT_LIST_LIMIT = 30
const DEFAULT_SEARCH_LIMIT = 30
const DEFAULT_TOKEN_LIMIT = 100
const MAX_LIST_LIMIT = 200
const MAX_SEARCH_LIMIT = 100
const MAX_CONTENT_CHARS = 100_000
const DEFAULT_CONTENT_CHARS = 20_000
const DAY_ID_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const dayIdSchema = z.string().regex(DAY_ID_PATTERN, 'Use YYYY-MM-DD.')
const searchFilterSchema = z.enum(['open-todos', 'tags', 'mentions', 'headings'])

type ToolHandler = () => Promise<CallToolResult> | CallToolResult

export type NotesSnapshot = {
  source: unknown
  warnings: string[]
  days: Day[]
}

export type LoadNotes = () => Promise<NotesSnapshot>

const jsonResult = (value: unknown): CallToolResult => ({
  content: [
    {
      type: 'text',
      text: JSON.stringify(value, null, 2),
    },
  ],
})

const errorResult = (error: unknown): CallToolResult => ({
  isError: true,
  content: [
    {
      type: 'text',
      text: error instanceof Error ? error.message : 'Unknown MCP server error.',
    },
  ],
})

const runTool = async (handler: ToolHandler) => {
  try {
    return await handler()
  } catch (error) {
    return errorResult(error)
  }
}

const clampLimit = (value: number | undefined, defaultValue: number, maxValue: number) =>
  Math.min(Math.max(value ?? defaultValue, 1), maxValue)

const validateDateRange = (dateFrom?: string, dateTo?: string) => {
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new Error('date_from must be earlier than or equal to date_to.')
  }
}

const truncate = (value: string, maxChars: number) => {
  if (value.length <= maxChars) {
    return { text: value, truncated: false }
  }

  return { text: value.slice(0, maxChars), truncated: true }
}

const toDaySummary = (day: Day, includeContent: boolean, maxContentChars: number) => {
  const content = includeContent ? truncate(day.contentMd, maxContentChars) : null

  return {
    day_id: day.dayId,
    human_title: day.humanTitle,
    content_chars: day.contentMd.length,
    is_empty: !day.contentMd.trim(),
    updated_at: new Date(day.updatedAt).toISOString(),
    ...(content
      ? {
          content_md: content.text,
          content_truncated: content.truncated,
        }
      : {}),
  }
}

const loadFilteredDays = async (loadNotes: LoadNotes, options: DayFilterOptions = {}) => {
  const notesFile = await loadNotes()
  return {
    ...notesFile,
    days: filterDays(notesFile.days, options),
  }
}

export const registerReadTools = (server: McpServer, loadNotes: LoadNotes) => {
  server.registerTool(
    'get_system_prompt',
    {
      title: 'Get Daily Analyst System Prompt',
      description: 'Return the Daily Notes Analyst system prompt used by Rivolo.',
      annotations: { readOnlyHint: true },
    },
    async () =>
      runTool(() =>
        jsonResult({
          name: 'Daily Notes Analyst',
          prompt: DAILY_ANALYST_SYSTEM_PROMPT,
        }),
      ),
  )

  server.registerTool(
    'list_days',
    {
      title: 'List Days',
      description: 'List Rivolo day entries from the local markdown file. Metadata only by default.',
      inputSchema: {
        date_from: dayIdSchema.optional(),
        date_to: dayIdSchema.optional(),
        before_day_id: dayIdSchema.optional(),
        limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional(),
        include_empty: z.boolean().optional(),
        include_content: z.boolean().optional(),
        max_content_chars: z.number().int().min(1).max(MAX_CONTENT_CHARS).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      runTool(async () => {
        validateDateRange(args.date_from, args.date_to)
        const limit = clampLimit(args.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
        const maxContentChars = clampLimit(args.max_content_chars, DEFAULT_CONTENT_CHARS, MAX_CONTENT_CHARS)
        const notesFile = await loadFilteredDays(loadNotes, {
          dateFrom: args.date_from,
          dateTo: args.date_to,
          beforeDayId: args.before_day_id,
          includeEmpty: args.include_empty ?? false,
        })
        const days = notesFile.days.slice(0, limit)

        return jsonResult({
          source: notesFile.source,
          warnings: notesFile.warnings,
          count: days.length,
          total_matches: notesFile.days.length,
          has_more: notesFile.days.length > days.length,
          days: days.map((day) => toDaySummary(day, Boolean(args.include_content), maxContentChars)),
        })
      }),
  )

  server.registerTool(
    'get_day',
    {
      title: 'Get Day',
      description: 'Return the full markdown content for one Rivolo day entry.',
      inputSchema: {
        day_id: dayIdSchema,
      },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      runTool(async () => {
        const notesFile = await loadNotes()
        const day = notesFile.days.find((candidate) => candidate.dayId === args.day_id)

        if (!day) {
          return jsonResult({
            source: notesFile.source,
            warnings: notesFile.warnings,
            found: false,
            day_id: args.day_id,
          })
        }

        return jsonResult({
          source: notesFile.source,
          warnings: notesFile.warnings,
          found: true,
          day: toDaySummary(day, true, MAX_CONTENT_CHARS),
        })
      }),
  )

  server.registerTool(
    'search_notes',
    {
      title: 'Search Notes',
      description: 'Search Rivolo notes by text, open todos, tags, mentions, or headings.',
      inputSchema: {
        query: z.string().optional(),
        filter: searchFilterSchema.optional(),
        date_from: dayIdSchema.optional(),
        date_to: dayIdSchema.optional(),
        limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      runTool(async () => {
        validateDateRange(args.date_from, args.date_to)
        const limit = clampLimit(args.limit, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT)
        const notesFile = await loadFilteredDays(loadNotes, {
          dateFrom: args.date_from,
          dateTo: args.date_to,
          includeEmpty: false,
        })
        const results = searchDaysInMemory(
          notesFile.days,
          args.query ?? '',
          { filter: (args.filter as SearchFilter | undefined) ?? null },
          limit,
        )

        return jsonResult({
          source: notesFile.source,
          warnings: notesFile.warnings,
          count: results.length,
          results: results.map((result) => ({
            day: toDaySummary(result.day, false, DEFAULT_CONTENT_CHARS),
            block_kind: result.blockKind,
            matched_blocks: result.matchedBlocks,
          })),
        })
      }),
  )

  server.registerTool(
    'get_recent_days',
    {
      title: 'Get Recent Days',
      description: 'Return the most recent non-empty Rivolo days.',
      inputSchema: {
        limit: z.number().int().min(1).max(60).optional(),
        include_content: z.boolean().optional(),
        max_content_chars: z.number().int().min(1).max(MAX_CONTENT_CHARS).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      runTool(async () => {
        const limit = clampLimit(args.limit, 7, 60)
        const maxContentChars = clampLimit(args.max_content_chars, DEFAULT_CONTENT_CHARS, MAX_CONTENT_CHARS)
        const notesFile = await loadFilteredDays(loadNotes, { includeEmpty: false })
        const days = notesFile.days.slice(0, limit)

        return jsonResult({
          source: notesFile.source,
          warnings: notesFile.warnings,
          count: days.length,
          days: days.map((day) => toDaySummary(day, Boolean(args.include_content), maxContentChars)),
        })
      }),
  )

  server.registerTool(
    'list_open_todos',
    {
      title: 'List Open Todos',
      description: 'List unchecked markdown todos across Rivolo notes.',
      inputSchema: {
        date_from: dayIdSchema.optional(),
        date_to: dayIdSchema.optional(),
        limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      runTool(async () => {
        validateDateRange(args.date_from, args.date_to)
        const limit = clampLimit(args.limit, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT)
        const notesFile = await loadFilteredDays(loadNotes, {
          dateFrom: args.date_from,
          dateTo: args.date_to,
          includeEmpty: false,
        })
        const todos = listOpenTodosFromDays(notesFile.days)

        return jsonResult({
          source: notesFile.source,
          warnings: notesFile.warnings,
          count: Math.min(todos.length, limit),
          total_matches: todos.length,
          todos: todos.slice(0, limit).map((todo) => ({
            day_id: todo.dayId,
            human_title: todo.humanTitle,
            line_number: todo.lineNumber,
            text: todo.text,
          })),
        })
      }),
  )

  server.registerTool(
    'list_tags',
    {
      title: 'List Tags',
      description: 'List hashtag tokens found in Rivolo notes.',
      inputSchema: {
        date_from: dayIdSchema.optional(),
        date_to: dayIdSchema.optional(),
        limit: z.number().int().min(1).max(DEFAULT_TOKEN_LIMIT).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      runTool(async () => {
        validateDateRange(args.date_from, args.date_to)
        const limit = clampLimit(args.limit, DEFAULT_TOKEN_LIMIT, DEFAULT_TOKEN_LIMIT)
        const notesFile = await loadFilteredDays(loadNotes, {
          dateFrom: args.date_from,
          dateTo: args.date_to,
          includeEmpty: false,
        })
        const tags = listTagsFromDays(notesFile.days)

        return jsonResult({
          source: notesFile.source,
          warnings: notesFile.warnings,
          count: Math.min(tags.length, limit),
          total_matches: tags.length,
          tags: tags.slice(0, limit),
        })
      }),
  )

  server.registerTool(
    'list_mentions',
    {
      title: 'List Mentions',
      description: 'List @mention tokens found in Rivolo notes.',
      inputSchema: {
        date_from: dayIdSchema.optional(),
        date_to: dayIdSchema.optional(),
        limit: z.number().int().min(1).max(DEFAULT_TOKEN_LIMIT).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      runTool(async () => {
        validateDateRange(args.date_from, args.date_to)
        const limit = clampLimit(args.limit, DEFAULT_TOKEN_LIMIT, DEFAULT_TOKEN_LIMIT)
        const notesFile = await loadFilteredDays(loadNotes, {
          dateFrom: args.date_from,
          dateTo: args.date_to,
          includeEmpty: false,
        })
        const mentions = listMentionsFromDays(notesFile.days)

        return jsonResult({
          source: notesFile.source,
          warnings: notesFile.warnings,
          count: Math.min(mentions.length, limit),
          total_matches: mentions.length,
          mentions: mentions.slice(0, limit),
        })
      }),
  )
}
