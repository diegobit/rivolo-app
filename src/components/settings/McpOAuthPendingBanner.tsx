import { buttonPrimary, buttonSecondary } from '../../lib/ui'
import type { McpOAuthPendingView } from '../../routes/settings/useMcpOAuthPending'

type McpOAuthPendingBannerProps = {
  view: McpOAuthPendingView
  onContinue: () => void
  onCancel: () => void
  onRetry: () => void
}

export default function McpOAuthPendingBanner({
  view,
  onContinue,
  onCancel,
  onRetry,
}: McpOAuthPendingBannerProps) {
  if (view.state === 'loading' || view.state === 'hidden') return null

  const pending = view.state === 'pending' ? view : null

  return (
    <section
      aria-labelledby="mcp-oauth-pending-title"
      className="mx-3 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-4 text-sm text-[var(--theme-text)] sm:mx-0"
    >
      <h2 id="mcp-oauth-pending-title" className="text-base font-semibold">
        Finish connecting ChatGPT
      </h2>
      {view.state === 'restart' && (
        <p className="mt-2 text-[var(--theme-text-muted)]">
          This connection expired or the browser did not keep it. Start again from ChatGPT.
        </p>
      )}
      {view.state === 'error' && (
        <p className="mt-2 text-[var(--theme-danger-text)]" role="alert">
          {view.message}
        </p>
      )}
      {pending && (
        <>
          <p className="mt-2 text-[var(--theme-text-muted)]">
            {pending.clientLabel} is waiting in this browser. Connect storage and enable Agent
            access here, then continue. Connecting does not approve access.
          </p>
          {pending.replaced && (
            <p className="mt-2 text-[var(--theme-text-muted)]" role="status">
              A newer connection replaced the previous one.
            </p>
          )}
          {pending.message && (
            <p className="mt-2 text-[var(--theme-danger-text)]" role="alert">
              {pending.message}
            </p>
          )}
        </>
      )}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        {pending && (
          <button
            type="button"
            className={`${buttonPrimary} min-h-11`}
            disabled={!pending.ready}
            onClick={onContinue}
          >
            Continue
          </button>
        )}
        {pending && (
          <button type="button" className={`${buttonSecondary} min-h-11`} onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="button" className={`${buttonSecondary} min-h-11`} onClick={onRetry}>
          Retry
        </button>
      </div>
    </section>
  )
}
