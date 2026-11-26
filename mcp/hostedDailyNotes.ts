import { createDropboxDailyRemote } from '../src/lib/dropboxDailyRemote'
import { createGoogleDriveDailyRemote } from '../src/lib/googleDriveDailyRemote'
import { createOneDriveDailyRemote } from '../src/lib/oneDriveDailyRemote'
import { createOneDriveGraph, type OneDriveGraphOptions } from '../src/lib/oneDriveGraphApi'
import { decodeNotebookDay, encodeNotebookDay, type DailyRemoteFile } from '../src/lib/notebookDays'
import { annotateLocalNotebook } from '../src/lib/oneDriveBlame'
import { addToDay, type AddToDayInput } from '../src/lib/noteWrites'
import { filterDays, sortDaysDescending, type Day, type DayFilterOptions } from '../src/lib/notesCore'
import { ProviderWriteNotAppliedError } from './providerWriteErrors.js'

type DailyFiles<File extends DailyRemoteFile> = {
  inventory(folder: string): Promise<Map<string, File>>
  stat(folder: string, dayId: string): Promise<File | null>
  download(file: File, dayId: string): Promise<string>
  prepareWrite(folder: string, dayId: string, file: File | null): Promise<(content: string, beforeCommit: () => Promise<void>) => Promise<File>>
  writeHosted?(folder: string, dayId: string, current: File | null, content: string): Promise<string>
  isConflict(error: unknown): boolean
}

function createNotes<File extends DailyRemoteFile>(
  remote: DailyFiles<File>,
  provider: string,
  folder: string,
  author = 'Agent',
  onCommitted?: (id: string, file: File) => Promise<void>,
) {
  const source = { provider, folderId: folder, format: 'daily' }
  const readDay = async (file: File, id: string) => {
    const content = await remote.download(file, id)
    const day = decodeNotebookDay(content, id)
    const modified = Date.parse(file.modifiedAt ?? '')
    const timestamp = Number.isFinite(modified) ? modified : Date.parse(`${id}T00:00:00Z`)
    return { content, day: { ...day, createdAt: timestamp, updatedAt: timestamp } satisfies Day }
  }

  const loadNotes = async (range?: DayFilterOptions) => {
    const days: Day[] = []
    if (range?.dateFrom && range.dateFrom === range.dateTo) {
      const file = await remote.stat(folder, range.dateFrom)
      if (file) days.push((await readDay(file, range.dateFrom)).day)
    } else {
      const files = [...await remote.inventory(folder)].filter(([id]) =>
        (!range?.dateFrom || id >= range.dateFrom) && (!range?.dateTo || id <= range.dateTo))
      // Stay within the Worker's connection limit even for a cold notebook.
      let next = 0
      await Promise.all(Array.from({ length: Math.min(4, files.length) }, async () => {
        while (next < files.length) {
          const [id, file] = files[next++]
          days.push((await readDay(file, id)).day)
        }
      }))
    }
    return { source, warnings: [], days: sortDaysDescending(filterDays(days, range)) }
  }

  const add = async (input: AddToDayInput) => {
    const id = input.day_id
    let previouslyExisted = false
    const preparationFailed = (error: unknown): never => {
      throw new ProviderWriteNotAppliedError(error instanceof Error ? error.message : 'Could not prepare the day.', { cause: error })
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const file = await remote.stat(folder, id).catch(preparationFailed)
      if (provider === 'onedrive') {
        // Keep the operation reserved so replay cannot recreate the deleted day.
        if (!file && previouslyExisted) {
          throw new Error('OneDrive deleted or moved this day while the agent was writing. Check the notebook before starting a new operation.')
        }
        previouslyExisted ||= Boolean(file)
      }
      let content: string
      let write: () => Promise<string>
      let mutation: ReturnType<typeof addToDay>
      try {
        const prior = file && await readDay(file, id)
        mutation = addToDay(prior ? [prior.day] : [], input)
        content = await annotateLocalNotebook(encodeNotebookDay(mutation.day), prior ? prior.content : '', author, mutation.day.updatedAt)
        const writeHosted = remote.writeHosted
        if (writeHosted) write = () => writeHosted(folder, id, file, content)
        else {
          const commit = await remote.prepareWrite(folder, id, file)
          write = async () => {
            const uploaded = await commit(content, async () => {})
            await onCommitted?.(id, uploaded)
            return content
          }
        }
      } catch (error) {
        return preparationFailed(error)
      }
      try {
        const written = await write()
        if (written !== content) mutation.day = { ...mutation.day, ...decodeNotebookDay(written, id) }
        const { day, created, position, operation_id } = mutation
        return { day, created, position, operation_id, source, conflictRetries: attempt }
      } catch (error) {
        if (!remote.isConflict(error)) throw error
        if (attempt === 2) throw new ProviderWriteNotAppliedError('The day changed repeatedly. Retry the write.', { cause: error })
      }
    }
    throw new Error('Daily write could not finish.')
  }
  return { loadNotes, add }
}

export const createHostedDailyNotes = (provider: 'dropbox' | 'google-drive', folder: string,
  authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>) => provider === 'dropbox'
  ? createNotes(createDropboxDailyRemote(authorizedFetch), provider, folder)
  : createNotes(createGoogleDriveDailyRemote(authorizedFetch), provider, folder)

export const createHostedOneDriveNotes = (
  folder: string,
  graph: OneDriveGraphOptions,
  author: string,
  onCommitted: (id: string, file: DailyRemoteFile) => Promise<void>,
) => createNotes(createOneDriveDailyRemote(createOneDriveGraph(graph)), 'onedrive', folder, author, onCommitted)
