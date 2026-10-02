const buttonActionBase =
  'inline-flex h-10 cursor-pointer items-center justify-center rounded-xl px-4 text-sm font-semibold shadow-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--theme-accent-rgb)/0.42)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-page)]'

export const buttonPrimary = `${buttonActionBase} bg-[var(--theme-accent)] text-[var(--theme-accent-contrast)] hover:bg-[var(--theme-accent-hover)] active:bg-[var(--theme-accent-active)] disabled:cursor-not-allowed disabled:bg-[var(--theme-surface-strong)] disabled:text-[var(--theme-text-muted)] disabled:shadow-none`

export const buttonSecondary = `${buttonActionBase} border border-[rgb(var(--theme-accent-rgb)/0.42)] bg-[var(--theme-surface)] text-[var(--theme-accent-text)] hover:border-[rgb(var(--theme-accent-rgb)/0.70)] hover:bg-[rgb(var(--theme-accent-rgb)/0.10)] active:bg-[rgb(var(--theme-accent-rgb)/0.16)] disabled:cursor-not-allowed disabled:border-[var(--theme-border)] disabled:bg-[var(--theme-surface-soft)] disabled:text-[var(--theme-text-subtle)] disabled:shadow-none`

export const buttonDanger = `${buttonActionBase} border border-[var(--theme-danger-border)] bg-[var(--theme-surface)] text-[var(--theme-danger-text)] hover:border-[var(--theme-danger-border)] hover:bg-[var(--theme-danger-soft)] active:bg-[var(--theme-danger-soft)] disabled:cursor-not-allowed disabled:border-[var(--theme-border)] disabled:bg-[var(--theme-surface-soft)] disabled:text-[var(--theme-text-subtle)] disabled:shadow-none`

// Text-style danger action for secondary destructive steps (disconnect, revoke),
// so they stay reachable without competing with setup actions.
export const buttonDangerQuiet =
  'inline-flex h-10 cursor-pointer items-center justify-center rounded-xl px-3 text-sm font-semibold text-[var(--theme-danger-text)] transition-colors outline-none hover:bg-[var(--theme-danger-soft)] active:bg-[var(--theme-danger-soft)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--theme-accent-rgb)/0.42)] disabled:cursor-not-allowed disabled:text-[var(--theme-text-subtle)] disabled:hover:bg-transparent'

export const buttonIcon =
  'flex h-8 w-8 items-center justify-center rounded-full border border-[rgb(var(--theme-accent-rgb)/0.42)] bg-[var(--theme-surface)] text-[var(--theme-accent)] shadow-sm transition hover:-translate-y-[1px] hover:border-[rgb(var(--theme-accent-rgb)/0.60)] hover:shadow-md'
