import { formatDayTitle, isValidDayId } from './dates.js'
import type { Day } from './notesCore.js'

export const MAX_NOTE_WRITE_CHARS = 20_000

export type NoteWritePosition = 'append' | 'prepend'

export type AddToDayInput = {
  day_id: string
  content_md: string
  position?: NoteWritePosition
  operation_id: string
}

export type AddToDayResult = {
  days: Day[]
  day: Day
  created: boolean
  position: NoteWritePosition
  operation_id: string
}

type AddToDayOptions = {
  now?: number
  maxContentChars?: number
}

const stripOuterBlankLines = (value: string) => {
  const lines = value.replace(/\r\n/g, '\n').split('\n')

  while (lines[0]?.trim() === '') {
    lines.shift()
  }

  while (lines.at(-1)?.trim() === '') {
    lines.pop()
  }

  return lines.join('\n')
}

const joinContent = (
  existingContent: string,
  addedContent: string,
  position: NoteWritePosition,
) => {
  const existing = stripOuterBlankLines(existingContent)
  const added = stripOuterBlankLines(addedContent)

  if (!existing) {
    return added
  }

  return position === 'prepend'
    ? `${added}\n\n${existing}`
    : `${existing}\n\n${added}`
}

const validateInput = (input: AddToDayInput, maxContentChars: number) => {
  if (!isValidDayId(input.day_id)) {
    throw new Error('day_id must be a valid calendar date in YYYY-MM-DD format.')
  }

  if (!input.content_md.trim()) {
    throw new Error('content_md must not be empty.')
  }

  if (input.content_md.length > maxContentChars) {
    throw new Error(`content_md must be ${maxContentChars} characters or fewer.`)
  }

  if (input.position !== undefined && input.position !== 'append' && input.position !== 'prepend') {
    throw new Error('position must be append or prepend.')
  }

  if (!input.operation_id.trim()) {
    throw new Error('operation_id must not be empty.')
  }
}

export const addToDay = (
  days: Day[],
  input: AddToDayInput,
  options: AddToDayOptions = {},
): AddToDayResult => {
  const maxContentChars = options.maxContentChars ?? MAX_NOTE_WRITE_CHARS
  validateInput(input, maxContentChars)

  const now = options.now ?? Date.now()
  const position = input.position ?? 'append'
  const existingIndex = days.findIndex((day) => day.dayId === input.day_id)
  const existingDay = days[existingIndex]
  const day: Day = existingDay
    ? {
        ...existingDay,
        contentMd: joinContent(existingDay.contentMd, input.content_md, position),
        updatedAt: now,
      }
    : {
        dayId: input.day_id,
        humanTitle: formatDayTitle(input.day_id),
        contentMd: stripOuterBlankLines(input.content_md),
        createdAt: now,
        updatedAt: now,
      }

  const nextDays = existingDay
    ? days.map((candidate, index) => (index === existingIndex ? day : candidate))
    : [...days, day]

  return {
    days: nextDays,
    day,
    created: !existingDay,
    position,
    operation_id: input.operation_id.trim(),
  }
}
