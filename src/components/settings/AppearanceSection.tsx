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
import SegmentedControl from '../SegmentedControl'
import SettingRow from './SettingRow'
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

const selectClass =
  'min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-slate-400'

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

  // Accent bar instead of a fill: the sample stays distinct in both themes
  // without drawing a box (boxes are reserved for collapsible rows).
  const fontPreview = (
    <div className="mb-3 border-l-2 border-[rgb(var(--theme-accent-rgb)/0.42)] py-1 pl-4">
      {renderFontPreviewContent()}
    </div>
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
      <div className="mt-2 divide-y divide-slate-200">
        <SettingRow label="Theme">
          <SegmentedControl
            label="Theme"
            options={(['system', 'light', 'dark'] as const).map((option) => ({
              value: option,
              label: themePreferenceLabels[option],
            }))}
            value={themePreference}
            onChange={onThemePreferenceChange}
          />
        </SettingRow>

        {!advanced && (
          <div>
            <SettingRow label="Font">
              <SegmentedControl
                label="Font preset"
                options={fontPresetOptions.map((option) => ({
                  value: option.id,
                  label: option.label,
                }))}
                value={fontPreset}
                onChange={onFontPresetChange}
              />
            </SettingRow>
            {fontPreset === 'custom' && (
              <p className="-mt-1 mb-3 text-xs text-slate-500">Custom font settings are active.</p>
            )}
            {fontPreview}
          </div>
        )}

        {advanced && (
          <div>
            {/* Font names are too long for a segmented control on phones, so
                these use native selects (the system picker on iOS). */}
            <SettingRow label="Title font" htmlFor="appearance-title-font">
              <select
                id="appearance-title-font"
                className={selectClass}
                value={titleFont}
                onChange={(event) => onTitleFontChange(event.target.value as TitleFont)}
              >
                {titleFontOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </SettingRow>
            <SettingRow label="Body font" htmlFor="appearance-body-font">
              <select
                id="appearance-body-font"
                className={selectClass}
                value={bodyFontChoice}
                onChange={(event) => onBodyFontChoiceChange(event.target.value as BodyFontChoice)}
              >
                {bodyFontChoiceOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </SettingRow>
            {fontPreview}
          </div>
        )}

        {advanced && (
          <div>
            <SettingRow label="Background">
              <SegmentedControl
                label="Background"
                options={[
                  { value: 'none', label: 'None', ariaLabel: 'No background' },
                  { value: 'thoughts-light', label: 'Light', ariaLabel: 'Rivolo Light' },
                  { value: 'thoughts-high', label: 'Strong', ariaLabel: 'Rivolo Strong' },
                ] as const}
                value={wallpaper}
                onChange={onWallpaperChange}
              />
            </SettingRow>
            <div
              className="relative mb-3 overflow-hidden rounded-xl bg-[var(--theme-page)] sm:hidden"
              role="img"
              aria-label={wallpaperPreviewLabel}
            >
              <div className="invisible px-4 py-3" aria-hidden="true">
                {renderFontPreviewContent()}
              </div>
              <div
                className={`absolute inset-0 bg-[url('/bg-thoughts.jpg')] bg-fixed bg-cover bg-center transition-[filter,opacity] duration-[600ms] motion-reduce:transition-none ${wallpaperPreviewOpacity}`}
                style={{ filter: 'var(--theme-wallpaper-filter)' }}
                aria-hidden="true"
              />
            </div>
          </div>
        )}

        <div>
          <div className="-mx-3">
            <SettingsToggle
              checked={autocorrection}
              label="Autocorrection"
              onChange={onAutocorrectionChange}
            />
          </div>
        </div>
        {advanced && (
          <div>
            <div className="-mx-3">
              <SettingsToggle
                checked={highlightInputMode}
                label="Highlight input mode (mobile only)"
                onChange={onHighlightInputModeChange}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
