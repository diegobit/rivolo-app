import { getDatabase, runAtomicDatabaseMutation } from './db'
import { hasDirtyHashtags, readHashtagSuggestions, refreshHashtagIndex } from './hashtagIndex'

export const findHashtagSuggestions = async (prefix: string, excludeDayId: string) => {
  const db = await getDatabase()
  if (hasDirtyHashtags(db)) await runAtomicDatabaseMutation(refreshHashtagIndex)
  return readHashtagSuggestions(db, prefix, excludeDayId)
}
