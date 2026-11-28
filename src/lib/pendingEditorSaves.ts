import { getPendingDayDraftIds } from './db'

// Include drafts waiting for the editor's debounce, not just persisted notes.
// Drafts registered with the database but not yet written count too: sync must
// not replace a day whose newer local text could still be committed over it.
const readers = new Set<() => string[]>()
let revision = 0

export const noteEditorChange = () => { revision += 1 }
export const getEditorRevision = () => revision
export const getPendingEditorDayIds = () => new Set([...[...readers].flatMap((read) => read()), ...getPendingDayDraftIds()])
export const registerPendingEditorSaves = (read: () => string[]) => {
  readers.add(read)
  return () => { readers.delete(read) }
}
