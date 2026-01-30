export type MonospaceFont =
  | 'fantasque'
  | 'iawriter'
  | 'inconsolata'

export type BodyFont = 'system' | 'lato'

export type TitleFont =
  | 'system'
  | 'bree'
  | 'grandstander'
  | 'handlee'

export const monospaceFontFamilies: Record<MonospaceFont, string> = {
  fantasque: "'Fantasque Sans Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  iawriter: "'iA Writer Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  inconsolata: "'Inconsolata', ui-monospace, SFMono-Regular, Menlo, monospace",
}

export const bodyFontFamilies: Record<BodyFont, string> = {
  system: "'Lato', 'Inter', system-ui, sans-serif",
  lato: "'Lato', 'Inter', system-ui, sans-serif",
}

export const titleFontFamilies: Record<TitleFont, string> = {
  system: "'Lato', 'Inter', system-ui, sans-serif",
  bree: "'Bree Serif', 'Times New Roman', serif",
  grandstander: "'Grandstander', 'Trebuchet MS', cursive",
  handlee: "'Handlee', 'Trebuchet MS', cursive",
}

export const monospaceFontOptions = [
  {
    id: 'iawriter',
    label: 'iA Writer Mono',
    fontFamily: monospaceFontFamilies.iawriter,
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
    label: 'Lato',
    fontFamily: bodyFontFamilies.system,
  },
] as const

export const titleFontOptions = [
  {
    id: 'system',
    label: 'Lato',
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
    id: 'handlee',
    label: 'Handlee',
    fontFamily: titleFontFamilies.handlee,
  },
] as const

export const getMonospaceFontFamily = (font: MonospaceFont) => monospaceFontFamilies[font]

export const getBodyFontFamily = (font: BodyFont) => bodyFontFamilies[font]

export const getTitleFontFamily = (font: TitleFont) => titleFontFamilies[font]

export const getMonospaceFontSize = (font: MonospaceFont) => {
  if (font === 'iawriter') return '0.95em'
  if (font === 'inconsolata') return '1.05rem'
  return '1rem'
}

export const isMonospaceFont = (value: string | null): value is MonospaceFont =>
  value === 'fantasque' ||
  value === 'iawriter' ||
  value === 'inconsolata'

export const isBodyFont = (value: string | null): value is BodyFont =>
  value === 'system' || value === 'lato'

export const isTitleFont = (value: string | null): value is TitleFont =>
  value === 'system' ||
  value === 'bree' ||
  value === 'grandstander' ||
  value === 'handlee'
