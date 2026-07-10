import {
  type BodyFontChoice,
  type FontPreset,
  type TitleFont,
  bodyFontChoiceOptions,
  fontPresetOptions,
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

      <div className="mt-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Font preset
        </h3>
        <div className="mt-3 flex flex-wrap gap-2">
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
        {fontPreset === 'custom' && (
          <p className="mt-2 text-xs text-slate-500">Custom font settings are active.</p>
        )}
      </div>

      {advanced && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Title font
          </h3>
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
      )}

      {advanced && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Body font
          </h3>
          <div className="mt-3 flex flex-wrap gap-2">
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
      )}

      {advanced && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Background
          </h3>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className={wallpaper === 'none' ? buttonPillActive : buttonPill}
              type="button"
              aria-pressed={wallpaper === 'none'}
              onClick={() => onWallpaperChange('none')}
            >
              No background
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
