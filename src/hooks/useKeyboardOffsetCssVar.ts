import { useEffect } from 'react'

export const useKeyboardOffsetCssVar = () => {
  useEffect(() => {
    const root = document.documentElement
    let animationFrame: number | null = null

    const writeKeyboardOffset = () => {
      if (!window.visualViewport) {
        root.style.setProperty('--keyboard-offset', '0px')
        document.body.dataset.keyboardOpen = 'false'
        return
      }

      const viewport = window.visualViewport
      const offset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
      root.style.setProperty('--keyboard-offset', `${Math.round(offset)}px`)
      document.body.dataset.keyboardOpen = offset > 0 ? 'true' : 'false'
    }

    const updateKeyboardOffset = () => {
      if (animationFrame !== null) {
        return
      }

      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null
        writeKeyboardOffset()
      })
    }

    writeKeyboardOffset()

    if (!window.visualViewport) return

    window.visualViewport.addEventListener('resize', updateKeyboardOffset)
    window.visualViewport.addEventListener('scroll', updateKeyboardOffset)
    window.addEventListener('resize', updateKeyboardOffset)
    window.addEventListener('orientationchange', updateKeyboardOffset)

    return () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame)
      }
      window.visualViewport?.removeEventListener('resize', updateKeyboardOffset)
      window.visualViewport?.removeEventListener('scroll', updateKeyboardOffset)
      window.removeEventListener('resize', updateKeyboardOffset)
      window.removeEventListener('orientationchange', updateKeyboardOffset)
    }
  }, [])
}
