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
    fontPreference: 'monospace',
    bodyFont: 'system',
    monospaceFont: 'iawriter',
    titleFont: 'handlee',
    showFontPreview: false,
    previewText: 'Preview text',
    titlePreviewFontFamily: 'system-ui',
    bodyPreviewFontFamily: 'system-ui',
    bodyPreviewFontSize: '1rem',
    onThemePreferenceChange: vi.fn(),
    onWallpaperChange: vi.fn(),
    onHighlightInputModeChange: vi.fn(),
    onAutocorrectionChange: vi.fn(),
    onTitleFontChange: vi.fn(),
    onBodyFontChange: vi.fn(),
    onMonospaceFontChange: vi.fn(),
    onFontPreviewToggle: vi.fn(),
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

    await userEvent.click(screen.getByRole('button', { name: 'System' }))
    expect(onThemePreferenceChange).toHaveBeenCalledExactlyOnceWith('system')
  })

  it('uses a theme-neutral no-background wallpaper label', async () => {
    const onWallpaperChange = vi.fn()
    renderSection({ wallpaper: 'none', onWallpaperChange })

    expect(screen.queryByRole('button', { name: 'White' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'No background' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await userEvent.click(screen.getByRole('button', { name: 'Rivolo Light' }))
    expect(onWallpaperChange).toHaveBeenCalledExactlyOnceWith('thoughts-light')
  })
})
