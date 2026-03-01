import {
  type BodyFont,
  type MonospaceFont,
  type TitleFont,
  bodyFontOptions,
  monospaceFontOptions,
  titleFontOptions,
} from '../../lib/fonts'
import { escapeHtml } from '../../lib/html'
import { buttonPill, buttonPillActive } from '../../lib/ui'

type AppearanceSectionProps = {
  wallpaper: 'white' | 'thoughts-light' | 'thoughts-medium' | 'thoughts-high'
  highlightInputMode: boolean
  fontPreference: 'proportional' | 'monospace'
  bodyFont: BodyFont
  monospaceFont: MonospaceFont
  titleFont: TitleFont
  showFontPreview: boolean
  previewHtml: string | null
  previewText: string
  titlePreviewFontFamily: string
  bodyPreviewFontFamily: string
  bodyPreviewFontSize: string
  onWallpaperChange: (value: 'white' | 'thoughts-light' | 'thoughts-medium' | 'thoughts-high') => void
  onHighlightInputModeChange: (enabled: boolean) => void
  onTitleFontChange: (font: TitleFont) => void
  onBodyFontChange: (font: BodyFont) => void
  onMonospaceFontChange: (font: MonospaceFont) => void
  onFontPreviewToggle: (event: React.SyntheticEvent<HTMLDetailsElement>) => void
}

export default function AppearanceSection({
  wallpaper,
  highlightInputMode,
  fontPreference,
  bodyFont,
  monospaceFont,
  titleFont,
  showFontPreview,
  previewHtml,
  previewText,
  titlePreviewFontFamily,
  bodyPreviewFontFamily,
  bodyPreviewFontSize,
  onWallpaperChange,
  onHighlightInputModeChange,
  onTitleFontChange,
  onBodyFontChange,
  onMonospaceFontChange,
  onFontPreviewToggle,
}: AppearanceSectionProps) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-600">Appearance</h2>
      <div className="mt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Wallpaper</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className={wallpaper === 'white' ? buttonPillActive : buttonPill}
            type="button"
            onClick={() => onWallpaperChange('white')}
          >
            White
          </button>
          <button
            className={wallpaper === 'thoughts-light' ? buttonPillActive : buttonPill}
            type="button"
            onClick={() => onWallpaperChange('thoughts-light')}
          >
            Thoughts Light
          </button>
          <button
            className={wallpaper === 'thoughts-medium' ? buttonPillActive : buttonPill}
            type="button"
            onClick={() => onWallpaperChange('thoughts-medium')}
          >
            Thoughts Medium
          </button>
          <button
            className={wallpaper === 'thoughts-high' ? buttonPillActive : buttonPill}
            type="button"
            onClick={() => onWallpaperChange('thoughts-high')}
          >
            Thoughts High
          </button>
        </div>
      </div>

      <div className="mt-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Highlight Input Mode
        </h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className={highlightInputMode ? buttonPillActive : buttonPill}
            type="button"
            onClick={() => onHighlightInputModeChange(true)}
          >
            YES
          </button>
          <button
            className={!highlightInputMode ? buttonPillActive : buttonPill}
            type="button"
            onClick={() => onHighlightInputModeChange(false)}
          >
            NO
          </button>
        </div>
      </div>

      <div className="mt-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Title Font</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {titleFontOptions.map((option) => (
            <button
              key={option.id}
              className={titleFont === option.id ? buttonPillActive : buttonPill}
              type="button"
              onClick={() => onTitleFontChange(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Body Font</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {bodyFontOptions.map((option) => (
            <button
              key={option.id}
              className={
                fontPreference === 'proportional' && bodyFont === option.id
                  ? buttonPillActive
                  : buttonPill
              }
              type="button"
              onClick={() => onBodyFontChange(option.id)}
            >
              {option.label}
            </button>
          ))}
          {monospaceFontOptions.map((option) => (
            <button
              key={option.id}
              className={
                fontPreference === 'monospace' && monospaceFont === option.id
                  ? buttonPillActive
                  : buttonPill
              }
              type="button"
              onClick={() => onMonospaceFontChange(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <details
          className="mt-4 rounded-xl border border-slate-200 bg-[#F8FAFC] px-4 py-3"
          onToggle={onFontPreviewToggle}
        >
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-500">
            Font Preview
          </summary>
          {showFontPreview && (
            <div className="mt-3 space-y-3 rounded-[4px] border border-slate-200/60 bg-white p-4 shadow-[0_6px_6px_-4px_rgba(0,0,0,0.10),0_2px_12px_rgba(0,0,0,0.06)]">
              <div
                className="flex flex-wrap items-baseline gap-2 text-3xl text-slate-900"
                style={{ fontFamily: titlePreviewFontFamily }}
              >
                <span className="font-bold">Today</span>
                <span className="font-normal text-slate-500">24, Saturday</span>
              </div>
              <pre
                className="overflow-x-auto whitespace-pre-wrap bg-transparent text-sm font-normal text-slate-900"
                style={{ fontFamily: bodyPreviewFontFamily, fontSize: bodyPreviewFontSize }}
              >
                <code
                  className="hljs language-markdown"
                  style={{ fontFamily: bodyPreviewFontFamily, fontSize: bodyPreviewFontSize }}
                  dangerouslySetInnerHTML={{ __html: previewHtml ?? escapeHtml(previewText) }}
                />
              </pre>
            </div>
          )}
        </details>
      </div>
    </section>
  )
}
