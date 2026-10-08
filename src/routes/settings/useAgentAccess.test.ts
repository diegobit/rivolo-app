import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  agentAccessDisableWarning,
  runConfirmedAgentAccessDisable,
  runWithAgentAccessSafety,
  useAgentAccess,
} from './useAgentAccess'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useAgentAccess', () => {
  it('loads Agent access status on mount', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ enabled: false }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useAgentAccess(true))

    await waitFor(() => expect(result.current.view.state).toBe('disabled'))
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/mcp/status', {
      cache: 'no-store',
      credentials: 'include',
    })
  })
})

describe('runWithAgentAccessSafety', () => {
  it('disables Agent access before switching provider or target', async () => {
    const order: string[] = []
    const result = await runWithAgentAccessSafety({
      statusKnown: true,
      enabled: true,
      confirmDisable: vi.fn(() => true),
      disable: vi.fn(async () => {
        order.push('disable')
        return true
      }),
      action: vi.fn(async () => {
        order.push('change')
      }),
    })

    expect(result).toBe('completed')
    expect(order).toEqual(['disable', 'change'])
  })

  it('does not switch provider or target when disabling fails', async () => {
    const action = vi.fn(async () => undefined)
    const result = await runWithAgentAccessSafety({
      statusKnown: true,
      enabled: true,
      confirmDisable: vi.fn(() => true),
      disable: vi.fn(async () => false),
      action,
    })

    expect(result).toBe('disable-failed')
    expect(action).not.toHaveBeenCalled()
  })

  it('blocks the change while Agent access status is unknown', async () => {
    const disable = vi.fn(async () => true)
    const action = vi.fn(async () => undefined)
    const result = await runWithAgentAccessSafety({
      statusKnown: false,
      enabled: false,
      confirmDisable: vi.fn(() => true),
      disable,
      action,
    })

    expect(result).toBe('status-unknown')
    expect(disable).not.toHaveBeenCalled()
    expect(action).not.toHaveBeenCalled()
  })

  it('runs the action directly when Agent access is disabled', async () => {
    const disable = vi.fn(async () => true)
    const action = vi.fn(async () => undefined)
    const result = await runWithAgentAccessSafety({
      statusKnown: true,
      enabled: false,
      confirmDisable: vi.fn(() => true),
      disable,
      action,
    })

    expect(result).toBe('completed')
    expect(disable).not.toHaveBeenCalled()
    expect(action).toHaveBeenCalledOnce()
  })

  it('does not disable or change anything when the user cancels', async () => {
    const disable = vi.fn(async () => true)
    const action = vi.fn(async () => undefined)
    const result = await runWithAgentAccessSafety({
      statusKnown: true,
      enabled: true,
      confirmDisable: vi.fn(() => false),
      disable,
      action,
    })

    expect(result).toBe('cancelled')
    expect(disable).not.toHaveBeenCalled()
    expect(action).not.toHaveBeenCalled()
  })
})

describe('runConfirmedAgentAccessDisable', () => {
  it('warns about token revocation before direct disable', async () => {
    const confirmDisable = vi.fn(() => true)
    const disable = vi.fn(async () => true)

    await expect(
      runConfirmedAgentAccessDisable({ confirmDisable, disable }),
    ).resolves.toBe(true)
    expect(confirmDisable).toHaveBeenCalledExactlyOnceWith(
      agentAccessDisableWarning('Disabling Agent access'),
    )
    expect(confirmDisable.mock.calls[0]?.[0]).toContain(
      'Existing agent access tokens will be revoked',
    )
    expect(disable).toHaveBeenCalledOnce()
  })

  it('keeps direct Agent access enabled when the user cancels', async () => {
    const disable = vi.fn(async () => true)

    await expect(
      runConfirmedAgentAccessDisable({
        confirmDisable: vi.fn(() => false),
        disable,
      }),
    ).resolves.toBe(false)
    expect(disable).not.toHaveBeenCalled()
  })
})
