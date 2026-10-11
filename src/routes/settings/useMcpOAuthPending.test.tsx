import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMcpOAuthPending } from './useMcpOAuthPending'

const pending = (transactionId: string, ready: boolean) => ({
  pending: true,
  clientLabel: 'ChatGPT',
  transactionId,
  expiresAt: Math.floor(Date.now() / 1000) + 30,
  ready,
})

const wrapperFor = (search = '') =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[`/settings${search}`]}>{children}</MemoryRouter>
  }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('useMcpOAuthPending', () => {
  it('shows setup for a fresh authorization and leaves ordinary Settings alone', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(pending('transaction-a', false)), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const flagged = renderHook(() => useMcpOAuthPending(true), {
      wrapper: wrapperFor('?mcp_oauth=1'),
    })
    await waitFor(() => expect(flagged.result.current.view.state).toBe('pending'))
    if (flagged.result.current.view.state === 'pending') {
      expect(flagged.result.current.view.clientLabel).toBe('ChatGPT')
      expect(flagged.result.current.view.ready).toBe(false)
    }

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ pending: false }), { status: 200 }),
    )
    const ordinary = renderHook(() => useMcpOAuthPending(true), {
      wrapper: wrapperFor(''),
    })
    await waitFor(() => expect(ordinary.result.current.view.state).toBe('hidden'))

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const failed = renderHook(() => useMcpOAuthPending(true), {
      wrapper: wrapperFor(''),
    })
    await waitFor(() => expect(failed.result.current.view.state).toBe('hidden'))
    const flaggedFailure = renderHook(() => useMcpOAuthPending(true), {
      wrapper: wrapperFor('?mcp_oauth=1'),
    })
    await waitFor(() => expect(flaggedFailure.result.current.view.state).toBe('error'))
  })

  it('recovers a pending request when the Settings query flag is gone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(pending('transaction-a', false)), { status: 200 }),
      ),
    )
    const { result } = renderHook(() => useMcpOAuthPending(true), {
      wrapper: wrapperFor(''),
    })
    await waitFor(() => expect(result.current.view.state).toBe('pending'))
  })

  it('shows restart guidance when a recovered connection expires without the query flag', async () => {
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        calls += 1
        const body =
          calls === 1
            ? { ...pending('transaction-a', false), expiresAt: Math.floor(Date.now() / 1000) - 1 }
            : { pending: false }
        return new Response(JSON.stringify(body), { status: 200 })
      }),
    )
    const recovered = renderHook(() => useMcpOAuthPending(true), {
      wrapper: wrapperFor(''),
    })
    await waitFor(() => expect(recovered.result.current.view.state).toBe('restart'))
  })

  it('navigates once after Agent access becomes ready and keeps retry available', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(pending('transaction-a', false)), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(pending('transaction-a', true)), { status: 200 }),
      )
    vi.stubGlobal('fetch', fetchMock)
    const assign = vi.fn()
    const { result } = renderHook(() => useMcpOAuthPending(true, { assign }), {
      wrapper: wrapperFor('?mcp_oauth=1'),
    })
    await waitFor(() => expect(result.current.view.state).toBe('pending'))
    await result.current.continueAfterEnable()
    expect(assign).toHaveBeenCalledExactlyOnceWith(
      '/api/mcp/oauth/authorize?resume=transaction-a',
    )
    await result.current.continueAfterEnable()
    expect(assign).toHaveBeenCalledOnce()

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(pending('transaction-a', false)), { status: 200 }),
    )
    const stayed = renderHook(() => useMcpOAuthPending(true, { assign: vi.fn() }), {
      wrapper: wrapperFor('?mcp_oauth=1'),
    })
    await waitFor(() => expect(stayed.result.current.view.state).toBe('pending'))
    await stayed.result.current.continueAfterEnable()
    expect(stayed.result.current.view.state).toBe('pending')
  })

  it('cancels through the server page and surfaces expiry or a replaced transaction', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(pending('transaction-a', false)), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const assign = vi.fn()
    const { result } = renderHook(() => useMcpOAuthPending(true, { assign }), {
      wrapper: wrapperFor('?mcp_oauth=1'),
    })
    await waitFor(() => expect(result.current.view.state).toBe('pending'))
    result.current.cancel()
    expect(assign).toHaveBeenCalledExactlyOnceWith(
      '/api/mcp/oauth/authorize?resume=transaction-a&cancel=1',
    )
    expect(assign.mock.calls[0][0]).not.toContain('http')

    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        calls += 1
        const body =
          calls === 1
            ? { ...pending('transaction-a', false), expiresAt: Math.floor(Date.now() / 1000) - 1 }
            : { pending: false }
        return new Response(JSON.stringify(body), { status: 200 })
      }),
    )
    const expired = renderHook(() => useMcpOAuthPending(true), {
      wrapper: wrapperFor('?mcp_oauth=1'),
    })
    await waitFor(() => expect(expired.result.current.view.state).toBe('restart'))

    const replacedFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(pending('transaction-a', true)), { status: 200 }),
      )
      .mockResolvedValue(
        new Response(JSON.stringify(pending('transaction-b', true)), { status: 200 }),
      )
    vi.stubGlobal('fetch', replacedFetch)
    const replaced = renderHook(() => useMcpOAuthPending(true), {
      wrapper: wrapperFor('?mcp_oauth=1'),
    })
    await waitFor(() => expect(replaced.result.current.view.state).toBe('pending'))
    await replaced.result.current.load()
    await waitFor(() => {
      expect(replaced.result.current.view.state).toBe('pending')
      if (replaced.result.current.view.state === 'pending') {
        expect(replaced.result.current.view.replaced).toBe(true)
        expect(replaced.result.current.view.transactionId).toBe('transaction-b')
      }
    })
  })
})
