import CodeMirror from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import {
  type BodyFont,
  type MonospaceFont,
  type TitleFont,
  bodyFontOptions,
  monospaceFontOptions,
  titleFontOptions,
} from '../../lib/fonts'
import { editorHighlights } from '../../lib/editorHighlights'
import { buttonPill, buttonPillActive } from '../../lib/ui'
import AccordionRow from './AccordionRow'
import SettingsToggle from './SettingsToggle'

const previewMarkdownExtension = markdown({ base: markdownLanguage })
const previewEditorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    fontSize: 'inherit',
  },
  '.cm-content': {
    minHeight: '0',
    padding: '0',
  },
  '.cm-line': {
    padding: '0',
  },
  '.cm-gutters': {
    display: 'none',
  },
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
  '&.cm-focused': {
    outline: 'none',
  },
})

type AppearanceSectionProps = {
  wallpaper: 'white' | 'thoughts-light' | 'thoughts-high'
  highlightInputMode: boolean
  autocorrection: boolean
  fontPreference: 'proportional' | 'monospace'
  bodyFont: BodyFont
  monospaceFont: MonospaceFont
  titleFont: TitleFont
  showFontPreview: boolean
  previewText: string
  titlePreviewFontFamily: string
  bodyPreviewFontFamily: string
  bodyPreviewFontSize: string
  onWallpaperChange: (value: 'white' | 'thoughts-light' | 'thoughts-high') => void
  onHighlightInputModeChange: (enabled: boolean) => void
  onAutocorrectionChange: (enabled: boolean) => void
  onTitleFontChange: (font: TitleFont) => void
  onBodyFontChange: (font: BodyFont) => void
  onMonospaceFontChange: (font: MonospaceFont) => void
  onFontPreviewToggle: () => void
}

export default function AppearanceSection({
  wallpaper,
  highlightInputMode,
  autocorrection,
  fontPreference,
  bodyFont,
  monospaceFont,
  titleFont,
  showFontPreview,
  previewText,
  titlePreviewFontFamily,
  bodyPreviewFontFamily,
  bodyPreviewFontSize,
  onWallpaperChange,
  onHighlightInputModeChange,
  onAutocorrectionChange,
  onTitleFontChange,
  onBodyFontChange,
  onMonospaceFontChange,
  onFontPreviewToggle,
}: AppearanceSectionProps) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-bold text-slate-700">Appearance</h2>
      <div className="mt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Wallpaper</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className={wallpaper === 'white' ? buttonPillActive : buttonPill}
            type="button"
            aria-pressed={wallpaper === 'white'}
            onClick={() => onWallpaperChange('white')}
          >
            White
          </button>
          <button
            className={wallpaper === 'thoughts-light' ? buttonPillActive : buttonPill}
            type="button"
            aria-pressed={wallpaper === 'thoughts-light'}
            onClick={() => onWallpaperChange('thoughts-light')}
          >
            Rivolo Light
          </button>
          <button
            className={wallpaper === 'thoughts-high' ? buttonPillActive : buttonPill}
            type="button"
            aria-pressed={wallpaper === 'thoughts-high'}
            onClick={() => onWallpaperChange('thoughts-high')}
          >
            Rivolo Strong
          </button>
        </div>
      </div>

      <div className="mt-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Editor behavior
        </h3>
        <div className="mt-2 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200">
          <SettingsToggle
            checked={highlightInputMode}
            label="Highlight input mode"
            onChange={onHighlightInputModeChange}
          />
          <SettingsToggle
            checked={autocorrection}
            label="Autocorrection"
            onChange={onAutocorrectionChange}
          />
        </div>
      </div>

      <div className="mt-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Title Font</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {titleFontOptions.map((option) => (
            <button
              key={option.id}
              className={titleFont === option.id ? buttonPillActive : buttonPill}
              type="button"
              aria-pressed={titleFont === option.id}
              onClick={() => onTitleFontChange(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Body Font</h3>
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
              aria-pressed={fontPreference === 'proportional' && bodyFont === option.id}
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
              aria-pressed={fontPreference === 'monospace' && monospaceFont === option.id}
              onClick={() => onMonospaceFontChange(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
          <AccordionRow
            label="Font Preview"
            isOpen={showFontPreview}
            onToggle={onFontPreviewToggle}
            panelId="font-preview-panel"
          >
            <div className="space-y-3 rounded-[4px] border border-slate-200/60 bg-white p-4 shadow-[0_6px_6px_-4px_rgba(0,0,0,0.10),0_2px_12px_rgba(0,0,0,0.06)]">
              <div
                className="flex flex-wrap items-baseline gap-2 text-3xl text-slate-900"
                style={{ fontFamily: titlePreviewFontFamily }}
              >
                <span className="font-bold">Today</span>
                <span className="font-normal text-slate-500">24, Saturday</span>
              </div>
              <div
                className="overflow-x-auto whitespace-pre-wrap bg-transparent text-sm font-normal text-slate-900"
                style={{ fontFamily: bodyPreviewFontFamily, fontSize: bodyPreviewFontSize }}
              >
                <CodeMirror
                  value={previewText}
                  extensions={[previewMarkdownExtension, previewEditorTheme, EditorView.lineWrapping, ...editorHighlights]}
                  editable={false}
                  basicSetup={{
                    lineNumbers: false,
                    foldGutter: false,
                    highlightActiveLine: false,
                    highlightActiveLineGutter: false,
                  }}
                  style={{ fontFamily: bodyPreviewFontFamily, fontSize: bodyPreviewFontSize }}
                />
              </div>
            </div>
          </AccordionRow>
        </div>
      </div>
    </section>
  )
}
