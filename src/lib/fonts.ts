export type MonospaceFont =
  | 'fantasque'
  | 'iawriter'
  | 'iawriterduo'
  | 'inconsolata'

export const monospaceFontFamilies: Record<MonospaceFont, string> = {
  fantasque: "'Fantasque Sans Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  iawriter: "'iA Writer Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  iawriterduo: "'iA Writer Duo', ui-monospace, SFMono-Regular, Menlo, monospace",
  inconsolata: "'Inconsolata', ui-monospace, SFMono-Regular, Menlo, monospace",
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

export const getMonospaceFontFamily = (font: MonospaceFont) => monospaceFontFamilies[font]

export const isMonospaceFont = (value: string | null): value is MonospaceFont =>
  value === 'fantasque' ||
  value === 'iawriter' ||
  value === 'iawriterduo' ||
  value === 'inconsolata'
