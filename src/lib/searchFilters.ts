import type { SearchFilter } from './dayRepository'

export const SEARCH_FILTER_LABELS: Record<SearchFilter, string> = {
  'open-todos': 'TODOs',
  tags: '# Tags',
  mentions: '@ Mentions',
  headings: 'Sections',
}

export const SEARCH_FILTER_OPTIONS = (
  Object.entries(SEARCH_FILTER_LABELS) as [SearchFilter, string][]
).map(([value, label]) => ({ value, label }))
