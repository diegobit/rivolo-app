export type MonospaceFont =
  | 'fantasque'
  | 'iawriter'
  | 'iawriterduo'
  | 'inconsolata'

export type BodyFont = 'system' | 'intertight'

export type TitleFont =
  | 'system'
  | 'bree'
  | 'grandstander'
  | 'caveat'
  | 'dosis'
  | 'spacegrotesk'

export const monospaceFontFamilies: Record<MonospaceFont, string> = {
  fantasque: "'Fantasque Sans Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  iawriter: "'iA Writer Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  iawriterduo: "'iA Writer Duo', ui-monospace, SFMono-Regular, Menlo, monospace",
  inconsolata: "'Inconsolata', ui-monospace, SFMono-Regular, Menlo, monospace",
}

export const bodyFontFamilies: Record<BodyFont, string> = {
  system: "'Inter', system-ui, sans-serif",
  intertight: "'Inter Tight', 'Inter', system-ui, sans-serif",
}

export const titleFontFamilies: Record<TitleFont, string> = {
  system: "'Inter', system-ui, sans-serif",
  bree: "'Bree Serif', 'Times New Roman', serif",
  grandstander: "'Grandstander', 'Trebuchet MS', cursive",
  caveat: "'Caveat', 'Trebuchet MS', cursive",
  dosis: "'Dosis', 'Trebuchet MS', sans-serif",
  spacegrotesk: "'Space Grotesk', 'Trebuchet MS', sans-serif",
}

export const monospaceFontOptions = [
  {
    id: 'iawriter',
    label: 'iA Writer Mono',
    fontFamily: monospaceFontFamilies.iawriter,
  },
  {
    id: 'iawriterduo',
    label: 'iA Writer Duo',
    fontFamily: monospaceFontFamilies.iawriterduo,
  },
  {
    id: 'inconsolata',
    label: 'Inconsolata',
    fontFamily: monospaceFontFamilies.inconsolata,
  },
  {
    id: 'fantasque',
    label: 'Fantasque',
    fontFamily: monospaceFontFamilies.fantasque,
  },
] as const

export const bodyFontOptions = [
  {
    id: 'system',
    label: 'System',
    fontFamily: bodyFontFamilies.system,
  },
  {
    id: 'intertight',
    label: 'Inter Tight',
    fontFamily: bodyFontFamilies.intertight,
  },
] as const

export const titleFontOptions = [
  {
    id: 'system',
    label: 'System',
    fontFamily: titleFontFamilies.system,
  },
  {
    id: 'bree',
    label: 'Bree Serif',
    fontFamily: titleFontFamilies.bree,
  },
  {
    id: 'grandstander',
    label: 'Grandstander',
    fontFamily: titleFontFamilies.grandstander,
  },
  {
    id: 'caveat',
    label: 'Caveat',
    fontFamily: titleFontFamilies.caveat,
  },
  {
    id: 'dosis',
    label: 'Dosis',
    fontFamily: titleFontFamilies.dosis,
  },
  {
    id: 'spacegrotesk',
    label: 'Space Grotesk',
    fontFamily: titleFontFamilies.spacegrotesk,
  },
] as const

export const getMonospaceFontFamily = (font: MonospaceFont) => monospaceFontFamilies[font]

export const getBodyFontFamily = (font: BodyFont) => bodyFontFamilies[font]

export const getTitleFontFamily = (font: TitleFont) => titleFontFamilies[font]

export const isMonospaceFont = (value: string | null): value is MonospaceFont =>
  value === 'fantasque' ||
  value === 'iawriter' ||
  value === 'iawriterduo' ||
  value === 'inconsolata'

export const isBodyFont = (value: string | null): value is BodyFont =>
  value === 'system' || value === 'intertight'

export const isTitleFont = (value: string | null): value is TitleFont =>
  value === 'system' ||
  value === 'bree' ||
  value === 'grandstander' ||
  value === 'caveat' ||
  value === 'dosis' ||
  value === 'spacegrotesk'
