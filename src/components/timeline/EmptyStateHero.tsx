import type { MutableRefObject } from 'react'

type EmptyStateHeroProps = {
  isLogoAnimating: boolean
  heroFontFamily: string
  buttonPrimaryClassName: string
  onStartToday: () => void
  heroLogoRef: MutableRefObject<HTMLImageElement | null>
}

export default function EmptyStateHero({
  isLogoAnimating,
  heroFontFamily,
  buttonPrimaryClassName,
  onStartToday,
  heroLogoRef,
}: EmptyStateHeroProps) {
  return (
    <section className="hero-empty relative my-auto flex min-h-[60vh] flex-col items-center justify-center gap-8 px-6 py-16 text-center sm:px-12 sm:py-20">
      <div className="absolute -right-16 -top-20 h-44 w-44 rounded-full bg-[#22B3FF]/10 blur-3xl" aria-hidden="true" />
      <div className="absolute -bottom-24 -left-10 h-36 w-36 rounded-full bg-[#22B3FF]/10 blur-3xl" aria-hidden="true" />
      <div className="relative flex items-center justify-center">
        <span className="absolute -inset-6 rounded-full bg-white/70 blur-2xl" aria-hidden="true" />
        <img
          ref={heroLogoRef}
          src="/logo.png"
          alt=""
          className={`hero-logo relative h-16 w-auto drop-shadow-[0_12px_30px_rgba(15,23,42,0.16)] transition-opacity duration-300 sm:h-20 ${
            isLogoAnimating ? 'opacity-0' : 'opacity-100'
          }`}
        />
      </div>
      <div className="hero-copy max-w-[550px] space-y-4" style={{ fontFamily: heroFontFamily }}>
        <p className="text-2xl text-slate-600">
          Rivolo replaces notes <br className="hero-break" /> with a daily flow.
        </p>
        <p className="text-2xl text-slate-600">
          Structure emerges only <br className="hero-break" /> when you ask for it.
        </p>
        <p className="text-2xl text-slate-600">Stop organizing. Start writing.</p>
      </div>
      <div className="flex flex-col items-center gap-4">
        <button className={`${buttonPrimaryClassName} px-6 py-3 text-base`} type="button" onClick={onStartToday}>
          Start Today
        </button>
        <p></p>
      </div>
    </section>
  )
}
