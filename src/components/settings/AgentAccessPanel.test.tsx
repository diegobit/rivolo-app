import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentAccessProfile } from '../../lib/agentAccess'
import AgentAccessPanel from './AgentAccessPanel'

const profile: AgentAccessProfile = {
  profileId: '00000000-0000-4000-8000-000000000001',
  provider: 'dropbox',
  providerAccountId: 'dbid:one',
  providerEmail: 'person@example.com',
  providerName: 'Person',
  target: { path: '/Journal/inbox.md' },
  timeZone: 'Europe/Rome',
  createdAt: '2026-07-16T10:00:00.000Z',
  updatedAt: '2026-07-16T10:00:00.000Z',
  revokedAt: null,
}

const callbacks = {
  onEnable: vi.fn(),
  onDisable: vi.fn(),
  onRetry: vi.fn(),
}

describe('AgentAccessPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(async () => undefined) },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ tokens: [] }), { status: 200 }),
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the disabled state simple and touch friendly', async () => {
    render(
      <AgentAccessPanel
        provider="dropbox"
        view={{ state: 'disabled', profile: null, message: null }}
        busy={false}
        online
        targetReady
        {...callbacks}
      />,
    )

    expect(screen.queryByText('Agents see only the latest cloud-synced notes.')).not.toBeInTheDocument()
    expect(screen.getByText('Agent access').closest('details')).not.toHaveAttribute('open')
    await userEvent.click(screen.getByText('Agent access'))
    expect(screen.queryByRole('button', { name: 'Copy endpoint' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy setup prompt' })).toBeInTheDocument()
    const enable = screen.getByRole('button', { name: 'Enable for Dropbox' })
    expect(enable).toHaveClass('min-h-11')
    await userEvent.click(enable)
    expect(callbacks.onEnable).toHaveBeenCalledOnce()
  })

  it('omits repeated sync details and copies endpoint and setup prompt', async () => {
    render(
      <AgentAccessPanel
        provider="dropbox"
        advanced
        view={{ state: 'enabled', profile, message: null }}
        busy={false}
        online
        targetReady
        {...callbacks}
      />,
    )

    expect(screen.getByText('Enabled')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Agent access'))
    expect(screen.queryByText('Provider')).not.toBeInTheDocument()
    expect(screen.queryByText('Person (person@example.com)')).not.toBeInTheDocument()
    expect(screen.queryByText('/Journal/inbox.md')).not.toBeInTheDocument()
    expect(screen.queryByText('Europe/Rome')).not.toBeInTheDocument()
    expect(screen.getByText('https://mcp.rivolo.app/mcp')).toHaveClass('break-all')

    const copy = screen.getByRole('button', { name: 'Copy endpoint' })
    expect(copy).toHaveClass('min-h-11')
    await userEvent.click(copy)
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://mcp.rivolo.app/mcp')
    expect(screen.getByRole('status')).toHaveTextContent('Copied.')

    await userEvent.click(screen.getByRole('button', { name: 'Copy setup prompt' }))
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(expect.stringContaining('Authorization: Bearer <YOUR_RIVOLO_TOKEN>'))

    await userEvent.click(screen.getByRole('button', { name: 'Disable Agent access' }))
    expect(callbacks.onDisable).toHaveBeenCalledOnce()
  })

  it('requires a ready cloud target and explains the missing target', async () => {
    render(
      <AgentAccessPanel
        provider="google-drive"
        view={{ state: 'disabled', profile: null, message: null }}
        busy={false}
        online
        targetReady={false}
        {...callbacks}
      />,
    )

    await userEvent.click(screen.getByText('Agent access'))
    expect(screen.getByRole('button', { name: 'Enable for Google Drive' })).toBeDisabled()
    expect(
      screen.getByText('Sync this provider once before enabling Agent access.'),
    ).toBeInTheDocument()
  })

  it('shows status errors with a retry action', async () => {
    render(
      <AgentAccessPanel
        provider="dropbox"
        view={{
          state: 'error',
          profile: null,
          message: 'Agent access status could not be loaded.',
        }}
        busy={false}
        online
        targetReady
        {...callbacks}
      />,
    )

    await userEvent.click(screen.getByText('Agent access'))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Agent access status could not be loaded.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(callbacks.onRetry).toHaveBeenCalledOnce()
  })
})
