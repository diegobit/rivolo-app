import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type BottomTrayPortalProps = {
  children: ReactNode
  containerId?: string
}

export default function BottomTrayPortal({ children, containerId = 'bottom-tray' }: BottomTrayPortalProps) {
  const [container, setContainer] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setContainer(document.getElementById(containerId))
  }, [containerId])

  if (!container) {
    return null
  }

  return createPortal(children, container)
}
