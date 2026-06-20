const buttonActionBase =
  'inline-flex h-10 cursor-pointer items-center justify-center rounded-xl px-4 text-sm font-semibold shadow-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#22B3FF]/40 focus-visible:ring-offset-2'

export const buttonPrimary = `${buttonActionBase} bg-[#22B3FF] text-white hover:bg-[#169fe6] active:bg-[#138dcc] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none`

export const buttonSecondary = `${buttonActionBase} border border-[#22B3FF]/40 bg-white text-[#159fe6] hover:border-[#22B3FF]/70 hover:bg-sky-50 active:bg-sky-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none`

export const buttonDanger = `${buttonActionBase} border border-rose-200 bg-white text-rose-600 hover:border-rose-300 hover:bg-rose-50 active:bg-rose-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none`

export const buttonIcon =
  'flex h-8 w-8 items-center justify-center rounded-full border border-[#22B3FF]/40 bg-white text-[#22B3FF] shadow-sm transition hover:-translate-y-[1px] hover:border-[#22B3FF]/60 hover:shadow-md'

export const buttonPill =
  'inline-flex min-h-7 cursor-pointer items-center justify-center rounded-full border border-[#22B3FF]/40 bg-white px-3 text-xs font-semibold text-[#159fe6] shadow-sm transition-colors outline-none hover:border-[#22B3FF]/70 hover:bg-sky-50 active:bg-sky-100 focus-visible:ring-2 focus-visible:ring-[#22B3FF]/40 focus-visible:ring-offset-2'

export const buttonPillActive =
  'inline-flex min-h-7 cursor-pointer items-center justify-center rounded-full border border-[#22B3FF] bg-[#22B3FF] px-3 text-xs font-semibold text-white outline-none transition-colors hover:bg-[#169fe6] active:bg-[#138dcc] focus-visible:ring-2 focus-visible:ring-[#22B3FF]/40 focus-visible:ring-offset-2'
