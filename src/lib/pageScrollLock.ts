let lockCount = 0
let restore: (() => void) | null = null

export function lockPageScroll() {
  if (lockCount++ === 0) {
    const root = document.documentElement.style
    const body = document.body.style
    const scrollY = window.scrollY
    const previous = [root.overflow, root.overscrollBehavior, body.overflow, body.overscrollBehavior]
    root.overflow = 'hidden'
    root.overscrollBehavior = 'none'
    body.overflow = 'hidden'
    body.overscrollBehavior = 'none'
    restore = () => {
      root.overflow = previous[0]
      root.overscrollBehavior = previous[1]
      body.overflow = previous[2]
      body.overscrollBehavior = previous[3]
      requestAnimationFrame(() => {
        if (lockCount === 0) window.scrollTo(0, scrollY)
      })
    }
  }

  return () => {
    if (--lockCount === 0) {
      restore?.()
      restore = null
    }
  }
}
