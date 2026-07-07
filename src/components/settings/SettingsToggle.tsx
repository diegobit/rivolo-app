type SettingsToggleProps = {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}

export default function SettingsToggle({ checked, label, onChange }: SettingsToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="flex min-h-[52px] w-full items-center justify-between gap-4 bg-[var(--theme-surface)] px-3 text-left outline-none transition-colors hover:bg-[var(--theme-hover)] active:bg-[var(--theme-active)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--theme-accent-rgb)/0.42)]"
      onClick={() => onChange(!checked)}
    >
      <span className="min-w-0 text-sm font-medium text-[var(--theme-text-soft)]">{label}</span>
      <span
        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-[var(--theme-accent)]' : 'bg-[var(--theme-surface-strong)]'
        }`}
        aria-hidden="true"
      >
        <span
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-[#ffffff] shadow-sm transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  )
}
