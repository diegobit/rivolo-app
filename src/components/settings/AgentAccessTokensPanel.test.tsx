import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentAccessToken,
  CreatedAgentAccessToken,
} from '../../lib/agentAccessTokens'
import AgentAccessTokensPanel from './AgentAccessTokensPanel'

const activeToken: AgentAccessToken = {
  tokenId: '00000000-0000-4000-8000-000000000011',
  name: 'Claude Desktop',
  prefix: 'rvl_example1',
  scopes: ['notes:read', 'notes:write'],
  createdAt: '2026-07-16T10:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
}

const createdToken: CreatedAgentAccessToken = {
  ...activeToken,
  token: 'rvl_one_time_secret',
}

describe('AgentAccessTokensPanel', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows a created secret once, then retains only non-secret metadata', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ token: createdToken }), { status: 201 })
      }
      return new Response(JSON.stringify({ tokens: [] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')

    render(
      <AgentAccessTokensPanel
        profileId="00000000-0000-4000-8000-000000000001"
        online
      />,
    )

    expect(await screen.findByText('No access tokens yet.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Token name'), 'Claude Desktop')
    await user.click(screen.getByRole('button', { name: 'Create token' }))

    const secretField = await screen.findByLabelText('New access token')
    expect(secretField).toHaveValue(createdToken.token)
    expect(screen.getByText('It cannot be recovered after you dismiss it.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Copy token' }))
    expect(writeText).toHaveBeenCalledWith(createdToken.token)

    await user.click(screen.getByRole('button', { name: 'I saved it — dismiss' }))
    expect(screen.queryByDisplayValue(createdToken.token)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain(createdToken.token)
    expect(screen.getByText('Claude Desktop')).toBeInTheDocument()
    expect(screen.getByText('rvl_example1…')).toBeInTheDocument()
  })

  it('clears a visible secret and refreshes metadata when the profile changes', async () => {
    const secondProfileToken: AgentAccessToken = {
      ...activeToken,
      tokenId: '00000000-0000-4000-8000-000000000022',
      name: 'Codex',
      prefix: 'rvl_profile2',
    }
    let getCount = 0
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ token: createdToken }), { status: 201 })
      }
      getCount += 1
      return new Response(
        JSON.stringify({ tokens: getCount === 1 ? [] : [secondProfileToken] }),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    const { rerender } = render(
      <AgentAccessTokensPanel
        profileId="00000000-0000-4000-8000-000000000001"
        online
      />,
    )
    await screen.findByText('No access tokens yet.')
    await user.type(screen.getByLabelText('Token name'), 'Claude Desktop')
    await user.click(screen.getByRole('button', { name: 'Create token' }))
    expect(await screen.findByDisplayValue(createdToken.token)).toBeInTheDocument()

    rerender(
      <AgentAccessTokensPanel
        profileId="00000000-0000-4000-8000-000000000002"
        online
      />,
    )

    expect(await screen.findByText('Codex')).toBeInTheDocument()
    expect(screen.queryByDisplayValue(createdToken.token)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain(createdToken.token)
  })

  it('requires explicit confirmation before revoking and then shows revoked metadata', async () => {
    const revokedToken = {
      ...activeToken,
      revokedAt: '2026-07-16T11:00:00.000Z',
    }
    let listCount = 0
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      listCount += 1
      return new Response(
        JSON.stringify({ tokens: listCount === 1 ? [activeToken] : [revokedToken] }),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const user = userEvent.setup()

    render(
      <AgentAccessTokensPanel
        profileId="00000000-0000-4000-8000-000000000001"
        online
      />,
    )

    const revoke = await screen.findByRole('button', { name: 'Revoke' })
    await user.click(revoke)
    expect(confirm).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)

    await user.click(revoke)
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true),
    )
    expect(await screen.findByText(/Revoked:/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument()
  })
})
