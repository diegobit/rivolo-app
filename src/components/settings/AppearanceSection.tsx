import {
  type BodyFontChoice,
  type FontPreset,
  type TitleFont,
  bodyFontChoiceFamilies,
  bodyFontChoiceOptions,
  fontPresetOptions,
  getMonospaceFontSize,
  titleFontFamilies,
  titleFontOptions,
} from '../../lib/fonts'
import { buttonPill, buttonPillActive } from '../../lib/ui'
import { themePreferenceLabels, type ThemePreference } from '../../lib/theme'
import SettingsToggle from './SettingsToggle'

type AppearanceSectionProps = {
  themePreference: ThemePreference
  wallpaper: 'none' | 'thoughts-light' | 'thoughts-high'
  highlightInputMode: boolean
  autocorrection: boolean
  fontPreset: FontPreset | 'custom'
  titleFont: TitleFont
  bodyFontChoice: BodyFontChoice
  advanced?: boolean
  onThemePreferenceChange: (value: ThemePreference) => void
  onWallpaperChange: (value: 'none' | 'thoughts-light' | 'thoughts-high') => void
  onHighlightInputModeChange: (enabled: boolean) => void
  onAutocorrectionChange: (enabled: boolean) => void
  onFontPresetChange: (preset: FontPreset) => void
  onTitleFontChange: (titleFont: TitleFont) => void
  onBodyFontChoiceChange: (choice: BodyFontChoice) => void
}

export default function AppearanceSection({
  themePreference,
  wallpaper,
  highlightInputMode,
  autocorrection,
  fontPreset,
  titleFont,
  bodyFontChoice,
  advanced = false,
  onThemePreferenceChange,
  onWallpaperChange,
  onHighlightInputModeChange,
  onAutocorrectionChange,
  onFontPresetChange,
  onTitleFontChange,
  onBodyFontChoiceChange,
}: AppearanceSectionProps) {
  const renderFontPreviewContent = () => (
    <>
      <p className="text-xl" style={{ fontFamily: titleFontFamilies[titleFont] }}>
        <span className="font-bold text-slate-700">Today</span>
        <span className="ml-2 font-normal text-slate-400">July 16</span>
      </p>
      <div
        className="mt-1 text-slate-700"
        style={{
          fontFamily: bodyFontChoiceFamilies[bodyFontChoice],
          fontSize: bodyFontChoice === 'lato' ? '0.98rem' : getMonospaceFontSize(bodyFontChoice),
        }}
      >
        <p>@bob send message for breakfast at 8:30</p>
        <p>Budget: 1,024 € + 15% ≈ 1,178 € --{'>'} due 31/12 (v1.0)</p>
      </div>
    </>
  )

  const fontPreview = (
    <div className="bg-slate-50 px-4 py-3">{renderFontPreviewContent()}</div>
  )

  const wallpaperPreviewOpacity =
    wallpaper === 'none'
      ? 'opacity-0'
      : wallpaper === 'thoughts-light'
        ? 'opacity-[var(--theme-wallpaper-light-opacity)]'
        : 'opacity-[var(--theme-wallpaper-strong-opacity)]'

  const wallpaperPreviewLabel =
    wallpaper === 'none'
      ? 'No background preview'
      : wallpaper === 'thoughts-light'
        ? 'Rivolo Light background preview'
        : 'Rivolo Strong background preview'

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <h2 className="text-lg font-bold text-slate-700">Appearance</h2>
      <div className="mt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Theme</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {(['system', 'light', 'dark'] as const).map((option) => (
            <button
              key={option}
              className={themePreference === option ? buttonPillActive : buttonPill}
              type="button"
              aria-pressed={themePreference === option}
              onClick={() => onThemePreferenceChange(option)}
            >
              {themePreferenceLabels[option]}
            </button>
          ))}
        </div>
      </div>

      {!advanced && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Font preset
          </h3>
          <div className="mt-2 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200">
            <div className="flex flex-wrap gap-2 px-3 py-2.5">
              {fontPresetOptions.map((option) => (
                <button
                  key={option.id}
                  className={fontPreset === option.id ? buttonPillActive : buttonPill}
                  type="button"
                  aria-pressed={fontPreset === option.id}
                  onClick={() => onFontPresetChange(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {fontPreview}
          </div>
          {fontPreset === 'custom' && (
            <p className="mt-2 text-xs text-slate-500">Custom font settings are active.</p>
          )}
        </div>
      )}

      {advanced && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Fonts</h3>
          <div className="mt-2 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200">
            <div className="flex items-center gap-3 px-3 py-2.5">
              <span className="w-9 shrink-0 text-xs font-medium text-slate-400">Title</span>
              <div className="flex flex-wrap gap-2">
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
            <div className="flex items-center gap-3 px-3 py-2.5">
              <span className="w-9 shrink-0 text-xs font-medium text-slate-400">Body</span>
              <div className="flex flex-wrap gap-2">
                {bodyFontChoiceOptions.map((option) => (
                  <button
                    key={option.id}
                    className={bodyFontChoice === option.id ? buttonPillActive : buttonPill}
                    type="button"
                    aria-pressed={bodyFontChoice === option.id}
                    onClick={() => onBodyFontChoiceChange(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            {fontPreview}
          </div>
        </div>
      )}

      {advanced && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Background
          </h3>
          <div className="mt-2 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200">
            <div className="flex flex-nowrap gap-2 px-3 py-2.5">
              <button
                className={wallpaper === 'none' ? buttonPillActive : buttonPill}
                type="button"
                aria-label="No background"
                aria-pressed={wallpaper === 'none'}
                onClick={() => onWallpaperChange('none')}
              >
                None
              </button>
              <button
                className={wallpaper === 'thoughts-light' ? buttonPillActive : buttonPill}
                type="button"
                aria-label="Rivolo Light"
                aria-pressed={wallpaper === 'thoughts-light'}
                onClick={() => onWallpaperChange('thoughts-light')}
              >
                Light
              </button>
              <button
                className={wallpaper === 'thoughts-high' ? buttonPillActive : buttonPill}
                type="button"
                aria-label="Rivolo Strong"
                aria-pressed={wallpaper === 'thoughts-high'}
                onClick={() => onWallpaperChange('thoughts-high')}
              >
                Strong
              </button>
            </div>
            <div
              className="relative overflow-hidden bg-[var(--theme-page)] sm:hidden"
              role="img"
              aria-label={wallpaperPreviewLabel}
            >
              <div className="invisible px-4 py-3" aria-hidden="true">
                {renderFontPreviewContent()}
              </div>
              <div
                className={`absolute inset-0 bg-[url('/bg-thoughts.jpg')] bg-cover bg-center transition-[filter,opacity] duration-[600ms] motion-reduce:transition-none ${wallpaperPreviewOpacity}`}
                style={{ filter: 'var(--theme-wallpaper-filter)' }}
                aria-hidden="true"
              />
            </div>
          </div>
        </div>
      )}

      <div className="mt-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Editor behavior
        </h3>
        <div className="mt-2 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200">
          <SettingsToggle
            checked={autocorrection}
            label="Autocorrection"
            onChange={onAutocorrectionChange}
          />
          {advanced && (
            <SettingsToggle
              checked={highlightInputMode}
              label="Highlight input mode"
              onChange={onHighlightInputModeChange}
            />
          )}
        </div>
      </div>
    </section>
  )
}
