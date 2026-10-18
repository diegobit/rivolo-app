import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import McpOAuthPendingBanner from './McpOAuthPendingBanner'
import type { McpOAuthPendingView } from '../../routes/settings/useMcpOAuthPending'

const pendingView = (ready: boolean): McpOAuthPendingView => ({
  state: 'pending',
  clientLabel: 'ChatGPT',
  transactionId: 'transaction-a',
  expiresAt: 1,
  ready,
  replaced: false,
  message: null,
})

describe('McpOAuthPendingBanner', () => {
  it('shows connect instructions with Continue and Cancel and does not approve automatically', async () => {
    const onContinue = vi.fn()
    const onCancel = vi.fn()
    const { rerender } = render(
      <McpOAuthPendingBanner
        view={pendingView(false)}
        onContinue={onContinue}
        onCancel={onCancel}
        onRetry={vi.fn()}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Finish connecting ChatGPT' })).toBeInTheDocument()
    expect(screen.getByText(/does not approve access/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onContinue).not.toHaveBeenCalled()

    rerender(
      <McpOAuthPendingBanner
        view={pendingView(true)}
        onContinue={onContinue}
        onCancel={onCancel}
        onRetry={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(onContinue).toHaveBeenCalledOnce()
  })

  it('shows restart guidance when the request is gone', () => {
    render(
      <McpOAuthPendingBanner
        view={{ state: 'restart' }}
        onContinue={vi.fn()}
        onCancel={vi.fn()}
        onRetry={vi.fn()}
      />,
    )
    expect(screen.getByText(/Start again from ChatGPT/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
  })
})
