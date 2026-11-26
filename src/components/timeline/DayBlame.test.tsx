import { render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DayBlameDetails } from './DayBlame'
import { useDayAttribution } from './useDayAttribution'
import { writeNotebookAuthors, writeNotebookAttribution } from '../../lib/oneDriveBlame'
import { exportMarkdown } from '../../lib/markdown'
import { groupLineAttribution } from '../../lib/editor/blameGutter'

const mocks = vi.hoisted(() => ({ state: vi.fn(), dailyState: vi.fn(), lastSyncAt: 1 }))
vi.mock('../../lib/oneDriveState', () => ({ getOneDriveState: mocks.state }))
vi.mock('../../lib/oneDriveDailyState', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/oneDriveDailyState')>(),
  getDailyState: mocks.dailyState,
}))
vi.mock('../../store/useSyncStore', () => ({ useSyncStore: (selector: (state: unknown) => unknown) => selector({ activeProvider: 'onedrive', status: { lastSyncAt: mocks.lastSyncAt } }) }))
const dayId = '2026-10-01'
const notebook = (contentMd: string) => exportMarkdown([{ dayId, contentMd, humanTitle: 'Thursday', createdAt: 0, updatedAt: 0 }])
const timestamp = new Date(2026, 9, 2, 12).getTime()
beforeEach(() => { vi.clearAllMocks(); mocks.lastSyncAt = 1; mocks.dailyState.mockResolvedValue(null) })
describe('day author gutter data', () => {
  it.each([null, { baseline: null }])('attributes a new daily note before its first push (checkpoint: %j)', async (checkpoint) => {
    mocks.state.mockResolvedValue({ folderId: 'notebook', accountId: 'alice', targetGeneration: 1, mergeBaseContent: null, accountName: 'Alice' })
    mocks.dailyState.mockResolvedValue(checkpoint)
    const { result, rerender } = renderHook(({ content }) => useDayAttribution(dayId, content, timestamp, true),
      { initialProps: { content: 'New note' } })
    await waitFor(() => expect(result.current.attribution).toEqual([{ author: 'Alice', date: '2026-10-02' }]))
    const reads = mocks.state.mock.calls.length
    // Further local typing needs neither a cloud request nor a first push.
    rerender({ content: 'New note\nMore text' })
    await waitFor(() => expect(result.current.attribution).toEqual([
      { author: 'Alice', date: '2026-10-02' }, { author: 'Alice', date: '2026-10-02' },
    ]))
    expect(mocks.state).toHaveBeenCalledTimes(reads)
  })
  it('preserves unknown historical lines in a daily baseline and attributes only local changes', async () => {
    mocks.state.mockResolvedValue({ folderId: 'notebook', mergeBaseContent: null, accountName: 'Alice' })
    mocks.dailyState.mockResolvedValue({ baseline: notebook('Historical note\nOld text') })
    const { result } = renderHook(() => useDayAttribution(dayId, 'Historical note\nNew text', timestamp, true))
    await waitFor(() => expect(result.current.attribution).toEqual([
      { author: null, date: null }, { author: 'Alice', date: '2026-10-02' },
    ]))
  })
  it('keeps a new daily note unknown when the account name is unavailable', async () => {
    mocks.state.mockResolvedValue({ folderId: 'notebook', mergeBaseContent: null, accountName: null })
    const { result } = renderHook(() => useDayAttribution(dayId, 'New note', timestamp, true))
    await waitFor(() => expect(result.current.attribution).toEqual([{ author: null, date: null }]))
  })
  it('loads authors only when the gutter is enabled and previews unsynced changes', async () => {
    const mergeBaseContent = await writeNotebookAuthors(notebook('First\nSecond'), new Map([[dayId, ['Bob', 'Carol']]]))
    mocks.state.mockResolvedValue({ mergeBaseContent, accountName: 'Alice' })
    const { result, rerender } = renderHook(({ enabled }) => useDayAttribution(dayId, 'First\nChanged', timestamp, enabled), { initialProps: { enabled: false } })
    expect(mocks.state).not.toHaveBeenCalled()
    expect(result.current.attribution).toBeNull()
    rerender({ enabled: true })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.attribution).toEqual([{ author: 'Bob', date: null }, { author: 'Alice', date: '2026-10-02' }])
  })
  it('keeps dates and groups consecutive lines without splitting an author into different date blocks', async () => {
    const content = 'First\nSecond\nThird'
    const mergeBaseContent = await writeNotebookAttribution(notebook(content), new Map([[dayId, [
      { author: 'Bob', date: dayId }, { author: 'Bob', date: '2026-10-02' }, { author: 'Bob', date: null },
    ]]]))
    mocks.state.mockResolvedValue({ mergeBaseContent, accountName: 'Alice' })
    const { result } = renderHook(() => useDayAttribution(dayId, content, timestamp, true))
    await waitFor(() => expect(result.current.attribution).not.toBeNull())
    expect(groupLineAttribution(result.current.attribution!, dayId)).toEqual([{ author: 'Bob', start: 0, end: 2, dates: ['2026-10-02'] }])
  })
  it('does not assign the signed-in user or a date to untracked historical notes', async () => {
    mocks.state.mockResolvedValue({ mergeBaseContent: null, accountName: 'Alice' })
    const { result } = renderHook(() => useDayAttribution(dayId, 'Historical note', timestamp, true))
    await waitFor(() => expect(result.current.attribution).toEqual([{ author: null, date: null }]))
  })
  it('provides attribution for every line without truncating long notes', async () => {
    mocks.state.mockResolvedValue({ mergeBaseContent: null, accountName: 'Alice' })
    const { result } = renderHook(() => useDayAttribution(dayId, Array.from({ length: 205 }, (_, i) => `Row ${i}`).join('\n'), timestamp, true))
    await waitFor(() => expect(result.current.attribution).toHaveLength(205))
  })
  it('reports a load failure and retries after toggling authors', async () => {
    mocks.state.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue({ mergeBaseContent: null, accountName: 'Alice' })
    const { result, rerender } = renderHook(({ enabled }) => useDayAttribution(dayId, 'Note', timestamp, enabled), { initialProps: { enabled: true } })
    await waitFor(() => expect(result.current.failed).toBe(true))
    rerender({ enabled: false }); rerender({ enabled: true })
    await waitFor(() => expect(result.current.attribution).toEqual([{ author: null, date: null }]))
    expect(result.current.failed).toBe(false)
  })
  it('refreshes authors after a sync while keeping the cached baseline during typing', async () => {
    const oldBase = await writeNotebookAuthors(notebook('First\nSecond'), new Map([[dayId, ['Bob', 'Bob']]]))
    const newBase = await writeNotebookAuthors(notebook('First\nRemote'), new Map([[dayId, ['Bob', 'Carol']]]))
    mocks.state.mockResolvedValue({ mergeBaseContent: oldBase, accountName: 'Alice' })
    const { result, rerender } = renderHook(({ content }) => useDayAttribution(dayId, content, timestamp, true),
      { initialProps: { content: 'First\nSecond' } })
    await waitFor(() => expect(result.current.loading).toBe(false))
    const previous = result.current.attribution
    rerender({ content: 'First\nLocal' })
    // Do not remove the gutter while the next alignment is pending.
    expect(result.current.attribution).toBe(previous)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mocks.state).toHaveBeenCalledTimes(1)
    mocks.state.mockResolvedValue({ mergeBaseContent: newBase, accountName: 'Alice' })
    mocks.lastSyncAt++
    rerender({ content: 'First\nRemote' })
    await waitFor(() => expect(result.current.attribution?.[1].author).toBe('Carol'))
    expect(mocks.state).toHaveBeenCalledTimes(2)
  })
  it('debounces rapid edits and ignores an obsolete baseline read', async () => {
    let finish!: (value: unknown) => void
    mocks.state.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const { result, rerender } = renderHook(({ content }) => useDayAttribution(dayId, content, timestamp, true),
      { initialProps: { content: 'Old draft' } })
    await waitFor(() => expect(mocks.state).toHaveBeenCalledTimes(1))
    rerender({ content: 'Intermediate draft' })
    rerender({ content: 'Final draft\nSecond line' })
    finish({ mergeBaseContent: notebook('Old draft'), accountName: 'Alice' })
    await waitFor(() => expect(result.current.attribution).toHaveLength(2))
    expect(result.current.attribution).toEqual([
      { author: 'Alice', date: '2026-10-02' }, { author: 'Alice', date: '2026-10-02' },
    ])
    expect(mocks.state).toHaveBeenCalledTimes(1)
  })
  it('shows the full author and different dates in a closable detail popup', async () => {
    const onClose = vi.fn()
    render(<DayBlameDetails group={{ author: 'Caterina Bruchi', start: 0, end: 2, dates: ['2026-10-02'] }} left={8} top={30} onClose={onClose} />)
    expect(screen.getByRole('dialog', { name: 'Line author details' })).toHaveTextContent('Caterina Bruchi')
    expect(screen.getByText('Oct 02, 2026')).toHaveAttribute('datetime', '2026-10-02')
    await userEvent.click(screen.getByRole('button', { name: 'Close author details' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
