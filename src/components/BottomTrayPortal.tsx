import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type BottomTrayPortalProps = {
  children: ReactNode
}

export default function BottomTrayPortal({ children }: BottomTrayPortalProps) {
  const [container, setContainer] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setContainer(document.getElementById('bottom-tray'))
  }, [])

  if (!container) {
    return null
  }

  return createPortal(children, container)
}
