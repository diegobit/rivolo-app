import { Facet, RangeSet, StateField, type EditorState } from '@codemirror/state'
import { EditorView, GutterMarker, ViewPlugin, gutter, type ViewUpdate } from '@codemirror/view'
import type { LineAttribution } from '../oneDriveBlame'
import { formatDayTitle } from '../dates'

export type BlameGroup = { author: string | null; start: number; end: number; dates: string[] }
export const authorInitials = (name: string | null) => {
  if (!name?.trim()) return '?'
  const parts = name.trim().split(/\s+/)
  return (parts.length === 1 ? Array.from(parts[0]).slice(0, 2).join('') :
    Array.from(parts[0])[0] + Array.from(parts.at(-1)!)[0]).toUpperCase()
}
// With `lines`, blank lines never start, end or split a block: it runs from an
// author's first line of text to their last, across the blank lines in between.
export const groupLineAttribution = (attribution: LineAttribution[], dayId: string, lines?: readonly string[]) => {
  const groups: BlameGroup[] = []
  let dates = new Set<string>()
  attribution.forEach(({ author, date }, index) => {
    if (lines && !lines[index]?.trim()) return
    let group = groups.at(-1)
    if (!group || group.author !== author) { group = { author, start: index, end: index, dates: [] }; groups.push(group); dates = new Set() }
    group.end = index
    if (date && date !== dayId && !dates.has(date)) { dates.add(date); group.dates.push(date) }
  })
  return groups
}

// The name picks the hue, so an author keeps one colour across reloads and devices.
// Two names landing on the same hue take neighbouring ones while any are free.
const AUTHOR_HUES = [220, 42, 145, 8, 265, 85, 185]
const authorHues = new Map<string | null, number>()
const authorHue = (author: string | null) => {
  const existing = authorHues.get(author)
  if (existing !== undefined) return existing
  let index = 0
  for (const character of author ?? '') index = (index * 31 + character.codePointAt(0)!) % AUTHOR_HUES.length
  const taken = new Set(authorHues.values())
  while (taken.size < AUTHOR_HUES.length && taken.has(AUTHOR_HUES[index])) index = (index + 1) % AUTHOR_HUES.length
  authorHues.set(author, AUTHOR_HUES[index])
  return AUTHOR_HUES[index]
}

class Spacer extends GutterMarker {
  toDOM() { const element = document.createElement('span'); element.className = 'cm-blame-spacer'; return element }
}
class Rail extends GutterMarker {
  readonly author: string | null
  readonly end: boolean
  constructor(author: string | null, end: boolean) {
    super(); this.author = author; this.end = end
    if (end) this.elementClass = 'cm-blame-end'
  }
  eq(other: Rail) { return this.author === other.author && this.end === other.end }
  toDOM() {
    const element = document.createElement('span')
    element.className = this.end ? 'cm-blame-rail cm-blame-end' : 'cm-blame-rail'
    element.style.setProperty('--blame-hue', String(authorHue(this.author)))
    return element
  }
}
class Badge extends GutterMarker {
  elementClass = 'cm-blame-start'
  readonly group: BlameGroup
  readonly open: (group: BlameGroup, anchor: HTMLElement) => void
  constructor(group: BlameGroup, open: Badge['open']) {
    super(); this.group = group; this.open = open
    if (group.start === group.end) this.elementClass += ' cm-blame-end'
  }
  eq(other: Badge) {
    return this.open === other.open && this.group.author === other.group.author &&
    this.group.start === other.group.start && this.group.end === other.group.end &&
    this.group.dates.length === other.group.dates.length && this.group.dates.every((date, i) => date === other.group.dates[i])
  }
  toDOM() {
    const button = document.createElement('button')
    const label = [this.group.author || 'Unknown author', ...this.group.dates.map(formatDayTitle)].join(' · ')
    button.type = 'button'
    button.className = 'cm-blame-badge'
    button.style.setProperty('--blame-hue', String(authorHue(this.group.author)))
    button.textContent = authorInitials(this.group.author)
    button.title = label
    button.setAttribute('aria-label', label)
    button.setAttribute('aria-haspopup', 'dialog')
    button.addEventListener('mousedown', (event) => { event.preventDefault(); event.stopPropagation() })
    button.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation() })
    button.addEventListener('click', (event) => { event.stopPropagation(); this.open(this.group, button) })
    // CodeMirror normally hides decorative gutters from assistive technology.
    // These markers are real buttons, so expose their containing gutter.
    queueMicrotask(() => button.closest('.cm-gutters')?.setAttribute('aria-hidden', 'false'))
    return button
  }
}

type BlameConfig = { dayId: string; attribution: LineAttribution[] | null; open: Badge['open'] }
const config = Facet.define<BlameConfig, BlameConfig>({ combine: (values) => values[0] })
const buildMarkers = (state: EditorState): RangeSet<GutterMarker> => {
  const { dayId, attribution, open } = state.facet(config)
  const rails = new Map<string | null, Rail>()
  const ranges = []
  for (const group of groupLineAttribution(attribution ?? [], dayId, state.doc.toJSON())) {
    if (!rails.has(group.author)) rails.set(group.author, new Rail(group.author, false))
    for (let index = group.start; index <= group.end; index++) {
      const marker: GutterMarker = index === group.start ? new Badge(group, open) :
        index === group.end ? new Rail(group.author, true) : rails.get(group.author)!
      ranges.push(marker.range(state.doc.line(index + 1).from))
    }
  }
  return RangeSet.of(ranges)
}
// Keep marker positions attached to text while the async attribution catches up.
// The field and gutter keep their identity across React reconfiguration.
const markers = StateField.define<RangeSet<GutterMarker>>({
  create: buildMarkers,
  update(value, transaction) {
    if (transaction.startState.facet(config) !== transaction.state.facet(config)) return buildMarkers(transaction.state)
    return transaction.docChanged ? value.map(transaction.changes) : value
  },
})
const authorGutter = gutter({
  class: 'cm-blame-gutter',
  renderEmptyElements: true,
  initialSpacer: () => new Spacer(),
  markers: (view) => view.state.field(markers),
})
// The rail is a ripple that runs from the badge to a drop. Each line draws its own
// piece, so the wave is a function of the distance from the top of the note: that
// keeps it unbroken from one line to the next.
const WAVE = 14, SWING = 1.8, TAIL = 18
const swing = (y: number) => 5 + SWING * Math.sin((2 * Math.PI * y) / WAVE)
const points = (from: number, to: number, shift = 0) => {
  const list = []
  for (let y = from; y <= to; y += 0.5) list.push(`${swing(y).toFixed(2)} ${(y - shift).toFixed(2)}`)
  return list.join('L')
}
const mask = (height: number, content: string) => `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='10' height='${height}'><g fill='none' stroke='#000' stroke-width='2' stroke-linecap='round'>${content}</g></svg>`)}")`
// The last TAIL pixels of a block: the wave straightens from wherever it is at
// `top`, a distance from the top of the note, and lands on the tip of the drop.
const tail = (top: number) => {
  const lean = SWING * ((2 * Math.PI) / WAVE) * Math.cos((2 * Math.PI * top) / WAVE) * 3.5
  return mask(TAIL + 2, `<path d='M${points(top - 2, top, top - 2)}C${(swing(top) + lean).toFixed(2)} 5.5 5 6 5 12'/>` +
    `<path fill='#000' stroke='none' d='M5 8C5 11 2.2 12.6 2.2 15.2a2.8 2.8 0 0 0 5.6 0C7.8 12.6 5 11 5 8Z'/>`)
}
// Headings and lists add space above their text. Each badge reads that space
// from its own line so it sits on the first row of text, not above it.
type Cell = readonly [cell: HTMLElement, values: Record<string, string>]
const badgeAlignment = ViewPlugin.fromClass(class {
  readonly request = {
    key: this,
    read: (view: EditorView) => [...view.dom.querySelectorAll<HTMLElement>('.cm-blame-gutter .cm-gutterElement')].map((cell): Cell => {
      const box = cell.getBoundingClientRect()
      const top = box.top - view.documentTop
      const values: Record<string, string> = { '--blame-y': `${(((top % WAVE) + WAVE) % WAVE).toFixed(2)}px` }
      if (cell.classList.contains('cm-blame-end')) values['--blame-tail'] = tail(Math.round((top + box.height - 7 - TAIL) * 100) / 100)
      if (cell.classList.contains('cm-blame-start')) {
        const { node } = view.domAtPos(view.lineBlockAtHeight(top + 1).from)
        const line = (node instanceof Element ? node : node.parentElement)?.closest('.cm-line')
        const space = line ? getComputedStyle(line).paddingTop : '0px'
        values['--blame-space'] = space
        // A block of one row has no room under its badge for a rail.
        const room = box.height - parseFloat(space) - (view.defaultLineHeight - 20) / 2 - 20 - 7
        values['--blame-rail'] = cell.classList.contains('cm-blame-end') && room < 12 ? 'none' : 'block'
      }
      return [cell, values]
    }),
    write: (cells: Cell[], view: EditorView) => {
      view.dom.querySelector<HTMLElement>('.cm-blame-gutter')?.style.setProperty('--blame-line', `${view.defaultLineHeight}px`)
      for (const [cell, values] of cells) for (const name in values) {
        if (cell.style.getPropertyValue(name) !== values[name]) cell.style.setProperty(name, values[name])
      }
    },
  }
  constructor(view: EditorView) { view.requestMeasure(this.request) }
  update(update: ViewUpdate) {
    if (update.geometryChanged || update.viewportChanged || update.startState.field(markers) !== update.state.field(markers)) {
      update.view.requestMeasure(this.request)
    }
  }
})
// Badge, ripple and drop share one colour, so they read as a single shape. The
// ripple and the drop are masks over that colour.
const fill = 'hsl(var(--blame-hue) var(--theme-blame-saturation) var(--theme-blame-lightness))'
const ripple = `${mask(WAVE, `<path d='M${points(-1, WAVE + 1)}'/>`)
} center calc(0px - var(--blame-y, 0px) - var(--blame-rail-top, 0px)) / 10px ${WAVE}px repeat-y content-box content-box`
const ending = `var(--blame-tail) bottom / 10px ${TAIL + 2}px no-repeat border-box border-box`
const theme = EditorView.theme({
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
  '.cm-blame-gutter': { width: '36px', minWidth: '36px', maxWidth: '36px', padding: '0', flexShrink: '0' },
  // --blame-top centres the 20px badge on the first row of text.
  '.cm-blame-gutter .cm-gutterElement': { padding: '0 4px', position: 'relative', boxSizing: 'border-box', overflow: 'visible',
    '--blame-top': 'calc(var(--blame-space, 0px) + (var(--blame-line, 22px) - 20px) / 2)' },
  '.cm-blame-spacer': { display: 'block', width: '28px' },
  '.cm-blame-badge': { display: 'block', width: '28px', height: '20px', margin: 'var(--blame-top) 0 0', padding: '0',
    border: '1px solid transparent', borderRadius: '10px', background: `${fill} border-box`,
    color: 'hsl(var(--blame-hue) 45% var(--theme-blame-text-lightness))', font: '600 11px/18px system-ui, sans-serif', boxSizing: 'border-box', cursor: 'pointer' },
  '.cm-blame-badge::before': { content: '""', position: 'absolute', top: 'calc(var(--blame-top) - 2px)', left: '1px', width: '34px', height: '24px' },
  '.cm-blame-badge:hover, .cm-blame-badge:focus-visible': { borderColor: 'var(--theme-accent)', outline: '2px solid var(--theme-accent)', outlineOffset: '1px' },
  // The rail starts under the badge's edge and its drop falls before the block's
  // last line ends, so it cannot be read as joining two authors.
  '.cm-blame-rail, .cm-blame-badge::after': { display: 'block', position: 'absolute', top: '0', bottom: '0', left: '13px',
    width: '10px', boxSizing: 'border-box', background: fill, mask: ripple, WebkitMask: ripple, pointerEvents: 'none' },
  '.cm-blame-badge::after': { content: '""', display: 'var(--blame-rail, block)', '--blame-rail-top': 'calc(var(--blame-top) + 19px)',
    top: 'var(--blame-rail-top)' },
  '.cm-blame-rail.cm-blame-end, .cm-blame-end .cm-blame-badge::after': { bottom: '7px', paddingBottom: `${TAIL}px`,
    mask: `${ripple}, ${ending}`, WebkitMask: `${ripple}, ${ending}` },
})

export const blameGutter = (dayId: string, attribution: LineAttribution[] | null, open: Badge['open']) =>
  [config.of({ dayId, attribution, open }), markers, authorGutter, badgeAlignment, theme]
