import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { isValidDayId } from '../src/lib/dates.js'
import {
  MAX_NOTE_WRITE_CHARS,
  type AddToDayInput,
  type AddToDayResult,
} from '../src/lib/noteWrites.js'
import {
  MAX_WRITE_OPERATION_ID_CHARS,
  MIN_WRITE_OPERATION_ID_CHARS,
  WRITE_OPERATION_ID_PATTERN,
} from '../src/lib/writeOperationId.js'

const DAY_ID_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const dayIdSchema = z
  .string()
  .regex(DAY_ID_PATTERN, 'Use YYYY-MM-DD.')
  .refine(isValidDayId, 'Use a valid calendar date in YYYY-MM-DD format.')

const contentSchema = z
  .string()
  .min(1, 'content_md must not be empty.')
  .max(
    MAX_NOTE_WRITE_CHARS,
    `content_md must be ${MAX_NOTE_WRITE_CHARS} characters or fewer.`,
  )
  .refine((value) => value.trim().length > 0, 'content_md must not be empty.')

const operationIdSchema = z
  .string()
  .min(
    MIN_WRITE_OPERATION_ID_CHARS,
    `operation_id must be at least ${MIN_WRITE_OPERATION_ID_CHARS} characters.`,
  )
  .max(
    MAX_WRITE_OPERATION_ID_CHARS,
    `operation_id must be ${MAX_WRITE_OPERATION_ID_CHARS} characters or fewer.`,
  )
  .regex(
    new RegExp(WRITE_OPERATION_ID_PATTERN),
    'operation_id contains unsupported characters.',
  )

const positionSchema = z.enum(['append', 'prepend']).default('append')

const addToDayInputSchema = z
  .object({
    day_id: dayIdSchema,
    content_md: contentSchema,
    operation_id: operationIdSchema,
    position: positionSchema,
  })
  .strict()

const addToTodayInputSchema = z
  .object({
    content_md: contentSchema,
    operation_id: operationIdSchema,
    position: positionSchema,
  })
  .strict()

type MaybePromise<T> = T | Promise<T>

export type AddToDayWriterResult = Pick<
  AddToDayResult,
  'day' | 'created' | 'position' | 'operation_id'
>

export type AddToDayWriter<Result extends AddToDayWriterResult = AddToDayWriterResult> = (
  input: AddToDayInput,
) => MaybePromise<Result>

export type ProfileTimeZone = string | (() => MaybePromise<string>)

export type ResolvedZonedDay = {
  day_id: string
  time_zone: string
}

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

const runTool = async (handler: () => MaybePromise<CallToolResult>) => {
  try {
    return await handler()
  } catch (error) {
    return errorResult(error)
  }
}

export const resolveDayIdInTimeZone = (
  timeZone: string,
  date = new Date(),
): ResolvedZonedDay => {
  const requestedTimeZone = timeZone.trim()
  if (!requestedTimeZone) {
    throw new Error('A valid IANA time zone is required.')
  }

  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone: requestedTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  } catch {
    throw new Error(`Invalid IANA time zone: ${requestedTimeZone}.`)
  }

  const parts = new Map(
    formatter
      .formatToParts(date)
      .filter((part) => part.type === 'year' || part.type === 'month' || part.type === 'day')
      .map((part) => [part.type, part.value]),
  )
  const year = parts.get('year')
  const month = parts.get('month')
  const day = parts.get('day')

  if (!year || !month || !day) {
    throw new Error(`Could not resolve a calendar date in ${requestedTimeZone}.`)
  }

  return {
    day_id: `${year}-${month}-${day}`,
    time_zone: formatter.resolvedOptions().timeZone,
  }
}

const resolveProfileTimeZone = async (profileTimeZone: ProfileTimeZone) =>
  typeof profileTimeZone === 'function'
    ? profileTimeZone()
    : profileTimeZone

const compactWriteResult = <Result extends AddToDayWriterResult>(result: Result) => {
  const { day, ...metadata } = result
  return {
    ...metadata,
    day_id: day.dayId,
    content_chars: day.contentMd.length,
  }
}

export const registerWriteTools = <Result extends AddToDayWriterResult>(
  server: McpServer,
  addToDay: AddToDayWriter<Result>,
  profileTimeZone: ProfileTimeZone,
) => {
  server.registerTool(
    'add_to_day',
    {
      title: 'Add to Day',
      description:
        'Add Markdown content to the end or beginning of one Rivolo day. This tool only adds content; it never replaces or deletes existing notes.',
      inputSchema: addToDayInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async (args) =>
      runTool(async () => {
        const result = await addToDay({
          day_id: args.day_id,
          content_md: args.content_md,
          operation_id: args.operation_id,
          position: args.position,
        })

        return jsonResult(compactWriteResult(result))
      }),
  )

  server.registerTool(
    'add_to_today',
    {
      title: 'Add to Today',
      description:
        "Add Markdown content to the end or beginning of today's Rivolo entry in the profile time zone. This tool only adds content; it never replaces or deletes existing notes.",
      inputSchema: addToTodayInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async (args) =>
      runTool(async () => {
        const resolvedDay = resolveDayIdInTimeZone(
          await resolveProfileTimeZone(profileTimeZone),
        )
        const result = await addToDay({
          day_id: resolvedDay.day_id,
          content_md: args.content_md,
          operation_id: args.operation_id,
          position: args.position,
        })

        return jsonResult({
          ...compactWriteResult(result),
          ...resolvedDay,
        })
      }),
  )
}
