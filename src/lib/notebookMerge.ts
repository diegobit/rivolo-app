import { exportMarkdown, parseMarkdown, type ParsedDay } from './markdown'
import { matchingLines, textLines } from './sequenceDiff'

const changes = (base: string[], next: string[]) => {
  const anchors = [...matchingLines(base, next), [base.length, next.length]]
  const replacements = new Map<number, number | null>()
  const additions = new Map<number, number[]>()
  let baseStart = 0
  let nextStart = 0
  for (const [baseEnd, nextEnd] of anchors) {
    const removed = baseEnd - baseStart
    const inserted = nextEnd - nextStart
    for (let k = 0; k < removed; k++) replacements.set(baseStart + k, k < inserted ? nextStart + k : null)
    if (inserted > removed) additions.set(baseEnd, Array.from({ length: inserted - removed }, (_, k) => nextStart + removed + k))
    baseStart = baseEnd + 1
    nextStart = nextEnd + 1
  }
  return { replacements, additions }
}

type MergedUnit = { text: string; side: 'base' | 'local' | 'remote'; index: number }
const containsSequence = (haystack: string[], needle: string[]) => {
  if (!needle.length || needle.length > haystack.length) return false
  const prefix = new Uint32Array(needle.length)
  for (let i = 1, j = 0; i < needle.length; i++) {
    while (j > 0 && needle[i] !== needle[j]) j = prefix[j - 1]
    if (needle[i] === needle[j]) j++
    prefix[i] = j
  }
  let j = 0
  for (const line of haystack) {
    while (j > 0 && line !== needle[j]) j = prefix[j - 1]
    if (line === needle[j]) j++
    if (j === needle.length) return true
  }
  return false
}

const mergeUnits = (base: string[], ours: string[], theirs: string[]): MergedUnit[] => {
  const local = changes(base, ours)
  const remote = changes(base, theirs)
  const result: MergedUnit[] = []
  for (let i = 0; i <= base.length; i++) {
    const remoteAdded = remote.additions.get(i) ?? []
    const localAdded = local.additions.get(i) ?? []
    const remoteTexts = remoteAdded.map((index) => theirs[index])
    const localTexts = localAdded.map((index) => ours[index])
    // Lines both sides added at the same place are kept once, whichever side
    // holds the longer run: the other side's run is already inside it.
    const remoteCoversLocal = containsSequence(remoteTexts, localTexts)
    const localCoversRemote = !remoteCoversLocal && containsSequence(localTexts, remoteTexts)
    if (!localCoversRemote) result.push(...remoteAdded.map((index) => ({ text: theirs[index], side: 'remote' as const, index })))
    if (!remoteCoversLocal) result.push(...localAdded.map((index) => ({ text: ours[index], side: 'local' as const, index })))
    if (i === base.length) break
    if (local.replacements.has(i)) {
      const index = local.replacements.get(i)
      if (index != null) result.push({ text: ours[index], side: 'local', index })
    } else if (remote.replacements.has(i)) {
      const index = remote.replacements.get(i)
      if (index != null) result.push({ text: theirs[index], side: 'remote', index })
    } else result.push({ text: base[i], side: 'base', index: i })
  }
  return result
}

export const mergeNotebookLines = (base: string, local: string, remote: string) => {
  if (local === remote || remote === base) return local
  if (local === base) return remote
  return mergeUnits(textLines(base), textLines(local), textLines(remote)).map((unit) => unit.text).join('\n')
}

const readNotebook = (content: string) => {
  if (!content.trim()) return new Map<string, ParsedDay>()
  const parsed = parseMarkdown(content)
  if (!parsed.days.length || parsed.warnings.length) {
    throw new Error('Notebook cannot be merged: check its day markers before syncing.')
  }
  return new Map(parsed.days.map((day) => [day.dayId, day]))
}

const mergeNotebook = (baseText: string, localText: string, remoteText: string,
  mergeContent: (id: string, base: string, local: string, remote: string) => string) => {
  const base = readNotebook(baseText)
  const local = readNotebook(localText)
  const remote = readNotebook(remoteText)
  const merged: ParsedDay[] = []
  for (const id of new Set([...base.keys(), ...remote.keys(), ...local.keys()])) {
    const before = base.get(id)
    const ours = local.get(id)
    const theirs = remote.get(id)
    if (!ours) {
      if (!before && theirs) merged.push(theirs)
      continue // Our deletion wins over a simultaneous edit.
    }
    if (!theirs) {
      if (!before || ours.contentMd !== before.contentMd || ours.humanTitle !== before.humanTitle) merged.push(ours)
      continue
    }
    merged.push({ ...ours,
      humanTitle: before && ours.humanTitle === before.humanTitle ? theirs.humanTitle : ours.humanTitle,
      contentMd: mergeContent(id, before?.contentMd ?? '', ours.contentMd, theirs.contentMd),
    })
  }
  return exportMarkdown(merged.map((day) => ({ ...day, createdAt: 0, updatedAt: 0 })))
}

export const mergeNotebooks = (base: string, local: string, remote: string) =>
  mergeNotebook(base, local, remote, (_id, before, ours, theirs) => mergeNotebookLines(before, ours, theirs))
