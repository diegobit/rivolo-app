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
      className="flex min-h-[52px] w-full items-center justify-between gap-4 bg-white px-3 text-left outline-none transition-colors hover:bg-slate-50 active:bg-slate-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#22B3FF]/40"
      onClick={() => onChange(!checked)}
    >
      <span className="min-w-0 text-sm font-medium text-slate-700">{label}</span>
      <span
        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-[#22B3FF]' : 'bg-slate-300'
        }`}
        aria-hidden="true"
      >
        <span
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  )
}
