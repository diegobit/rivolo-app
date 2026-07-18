import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import AppearanceSection from './AppearanceSection'

type Overrides = Partial<React.ComponentProps<typeof AppearanceSection>>

const renderSection = (overrides: Overrides = {}) => {
  const props: React.ComponentProps<typeof AppearanceSection> = {
    themePreference: 'system',
    wallpaper: 'thoughts-light',
    highlightInputMode: false,
    autocorrection: true,
    fontPreset: 'monospace',
    titleFont: 'handlee',
    bodyFontChoice: 'iawriter',
    onThemePreferenceChange: vi.fn(),
    onWallpaperChange: vi.fn(),
    onHighlightInputModeChange: vi.fn(),
    onAutocorrectionChange: vi.fn(),
    onFontPresetChange: vi.fn(),
    onTitleFontChange: vi.fn(),
    onBodyFontChoiceChange: vi.fn(),
    ...overrides,
  }

  render(<AppearanceSection {...props} />)
  return props
}

describe('AppearanceSection', () => {
  it('shows the selected theme and emits theme changes', async () => {
    const onThemePreferenceChange = vi.fn()
    renderSection({ themePreference: 'dark', onThemePreferenceChange })

    expect(screen.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'System' }).parentElement).toHaveClass(
      'rounded-xl',
      'border',
      'border-slate-200',
    )

    await userEvent.click(screen.getByRole('button', { name: 'System' }))
    expect(onThemePreferenceChange).toHaveBeenCalledExactlyOnceWith('system')
  })

  it('shows font presets and autocorrection in the basic section', async () => {
    const onFontPresetChange = vi.fn()
    renderSection({ fontPreset: 'proportional', onFontPresetChange })

    expect(screen.getByRole('button', { name: 'Monospace' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Proportional' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('switch', { name: 'Autocorrection' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'No background' })).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Highlight input mode' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Bree Serif' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Inconsolata' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Monospace' }))
    expect(onFontPresetChange).toHaveBeenCalledExactlyOnceWith('monospace')
  })

  it('adds background and editor controls alongside the basic controls in advanced mode', async () => {
    const onWallpaperChange = vi.fn()
    renderSection({ advanced: true, wallpaper: 'none', onWallpaperChange })

    // Basic controls remain, except the font preset row which the
    // title/body font pickers replace in advanced mode.
    expect(screen.queryByRole('button', { name: 'Monospace' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'System' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Autocorrection' })).toBeInTheDocument()
    // Advanced controls are added.
    expect(screen.getByRole('button', { name: 'No background' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('img', { name: 'No background preview' })).toHaveClass(
      'sm:hidden',
    )
    expect(screen.getByRole('switch', { name: 'Highlight input mode' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Rivolo Light' }))
    expect(onWallpaperChange).toHaveBeenCalledExactlyOnceWith('thoughts-light')
  })

  it('previews the selected background at the font sample height on mobile', () => {
    renderSection({ advanced: true, wallpaper: 'thoughts-high' })

    const preview = screen.getByRole('img', { name: 'Rivolo Strong background preview' })
    expect(preview).toHaveClass('sm:hidden')
    expect(preview.querySelector('.invisible')).toHaveTextContent(
      '@bob send message for breakfast at 8:30',
    )
    expect(preview.lastElementChild).toHaveClass(
      'opacity-[var(--theme-wallpaper-strong-opacity)]',
    )
  })

  it('offers individual title and body font pickers in advanced mode', async () => {
    const onTitleFontChange = vi.fn()
    const onBodyFontChoiceChange = vi.fn()
    renderSection({
      advanced: true,
      titleFont: 'handlee',
      bodyFontChoice: 'iawriter',
      onTitleFontChange,
      onBodyFontChoiceChange,
    })

    expect(screen.getByRole('button', { name: 'Handlee' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Bree Serif' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('button', { name: 'iA Writer Mono' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // 'Lato' appears in both pickers.
    expect(screen.getAllByRole('button', { name: 'Lato' })).toHaveLength(2)

    await userEvent.click(screen.getByRole('button', { name: 'Bree Serif' }))
    expect(onTitleFontChange).toHaveBeenCalledExactlyOnceWith('bree')

    await userEvent.click(screen.getByRole('button', { name: 'Inconsolata' }))
    expect(onBodyFontChoiceChange).toHaveBeenCalledExactlyOnceWith('inconsolata')
  })
})
