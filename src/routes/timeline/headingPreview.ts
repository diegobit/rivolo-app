import type { Day } from '../../lib/dayRepository'

export const HEADING_LINE_REGEX = /^\s{0,3}(#{1,6})\s+/
const HEADING_PREVIEW_LINE_COUNT = 3

const getHeadingSectionEndIndex = (lines: string[], headingStart: number, headingLevel: number) => {
  for (let index = headingStart + 1; index < lines.length; index += 1) {
    const headingMatch = lines[index].match(HEADING_LINE_REGEX)
    if (headingMatch && headingMatch[1].length <= headingLevel) {
      return index
    }
  }

  return lines.length
}

const buildHeadingPreview = (sectionLines: string[]) => {
  if (!sectionLines.length) {
    return {
      headingLine: '',
      displayBlock: '',
      hasMore: false,
    }
  }

  const headingLine = sectionLines[0]
  const bodyLines = sectionLines.slice(1)
  const previewBodyLines = bodyLines.slice(0, HEADING_PREVIEW_LINE_COUNT)

  return {
    headingLine,
    displayBlock: [headingLine, ...previewBodyLines].join('\n'),
    hasMore: bodyLines.length > HEADING_PREVIEW_LINE_COUNT,
  }
}

export const getHeadingPreviewFromSectionBlock = (block: string) => {
  const sectionLines = block.split('\n').map((line) => line.trimEnd())
  if (!sectionLines.length) {
    return null
  }

  if (!HEADING_LINE_REGEX.test(sectionLines[0])) {
    return null
  }

  return buildHeadingPreview(sectionLines)
}

export const getHeadingPreviewFromDay = (day: Day, headingLine: string) => {
  const normalizedHeadingLine = headingLine.trimEnd()
  if (!HEADING_LINE_REGEX.test(normalizedHeadingLine)) {
    return null
  }

  const lines = day.contentMd.split('\n')
  const headingIndex = lines.findIndex(
    (line) => line.trimEnd() === normalizedHeadingLine && HEADING_LINE_REGEX.test(line),
  )
  if (headingIndex < 0) {
    return null
  }

  const headingMatch = lines[headingIndex].match(HEADING_LINE_REGEX)
  if (!headingMatch) {
    return null
  }

  const sectionEnd = getHeadingSectionEndIndex(lines, headingIndex, headingMatch[1].length)
  const sectionLines = lines.slice(headingIndex, sectionEnd).map((line) => line.trimEnd())
  return buildHeadingPreview(sectionLines)
}
