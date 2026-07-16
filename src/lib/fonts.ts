export type MonospaceFont =
  | 'iawriter'
  | 'inconsolata'

export type BodyFont = 'system'

export type TitleFont =
  | 'system'
  | 'bree'
  | 'handlee'

export type FontPreference = 'proportional' | 'monospace'

export type FontPreset = 'monospace' | 'proportional'

export type BodyFontChoice = MonospaceFont | 'lato'

export const monospaceFontFamilies: Record<MonospaceFont, string> = {
  iawriter: "'iA Writer Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  inconsolata: "'Inconsolata', ui-monospace, SFMono-Regular, Menlo, monospace",
}

export const bodyFontFamilies: Record<BodyFont, string> = {
  system: "'Lato', 'Inter', system-ui, sans-serif",
}

export const titleFontFamilies: Record<TitleFont, string> = {
  system: "'Lato', 'Inter', system-ui, sans-serif",
  bree: "'Bree Serif', 'Times New Roman', serif",
  handlee: "'Handlee', 'Trebuchet MS', cursive",
}

export type FontPresetSettings = {
  fontPreference: FontPreference
  bodyFont: BodyFont
  monospaceFont: MonospaceFont
  titleFont: TitleFont
}

export const fontPresetOptions: Array<{
  id: FontPreset
  label: string
  settings: FontPresetSettings
}> = [
  {
    id: 'monospace',
    label: 'Monospace',
    settings: {
      fontPreference: 'monospace',
      bodyFont: 'system',
      monospaceFont: 'iawriter',
      titleFont: 'handlee',
    },
  },
  {
    id: 'proportional',
    label: 'Proportional',
    settings: {
      fontPreference: 'proportional',
      bodyFont: 'system',
      monospaceFont: 'iawriter',
      titleFont: 'handlee',
    },
  },
]

export const titleFontOptions: Array<{ id: TitleFont; label: string }> = [
  { id: 'handlee', label: 'Handlee' },
  { id: 'bree', label: 'Bree Serif' },
  { id: 'system', label: 'Lato' },
]

export const bodyFontChoiceOptions: Array<{ id: BodyFontChoice; label: string }> = [
  { id: 'iawriter', label: 'iA Writer Mono' },
  { id: 'inconsolata', label: 'Inconsolata' },
  { id: 'lato', label: 'Lato' },
]

export const bodyFontChoiceFamilies: Record<BodyFontChoice, string> = {
  iawriter: monospaceFontFamilies.iawriter,
  inconsolata: monospaceFontFamilies.inconsolata,
  lato: bodyFontFamilies.system,
}

export const getBodyFontChoice = (
  fontPreference: FontPreference,
  monospaceFont: MonospaceFont,
): BodyFontChoice => (fontPreference === 'monospace' ? monospaceFont : 'lato')

export const getMonospaceFontFamily = (font: MonospaceFont) => monospaceFontFamilies[font]

export const getBodyFontFamily = (font: BodyFont) => bodyFontFamilies[font]

export const getTitleFontFamily = (font: TitleFont) => titleFontFamilies[font]

export const getFontPresetSettings = (preset: FontPreset) =>
  fontPresetOptions.find((option) => option.id === preset)?.settings ?? fontPresetOptions[0].settings

export const getFontPreset = (
  fontPreference: FontPreference,
  bodyFont: BodyFont,
  monospaceFont: MonospaceFont,
  titleFont: TitleFont,
): FontPreset | 'custom' => {
  const match = fontPresetOptions.find(
    ({ settings }) =>
      settings.fontPreference === fontPreference &&
      settings.bodyFont === bodyFont &&
      settings.monospaceFont === monospaceFont &&
      settings.titleFont === titleFont,
  )
  return match?.id ?? 'custom'
}

export const getMonospaceFontSize = (font: MonospaceFont) => {
  if (font === 'iawriter') return '0.95em'
  return '1.05rem'
}

export const isMonospaceFont = (value: string | null): value is MonospaceFont =>
  value === 'iawriter' ||
  value === 'inconsolata'

export const isBodyFont = (value: string | null): value is BodyFont =>
  value === 'system'

export const isTitleFont = (value: string | null): value is TitleFont =>
  value === 'system' ||
  value === 'bree' ||
  value === 'handlee'
