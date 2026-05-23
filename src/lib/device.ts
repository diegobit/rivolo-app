export const isIOS = () => {
  if (typeof navigator === 'undefined') return false

  const userAgent = navigator.userAgent || ''

  if (/iPad|iPhone|iPod/.test(userAgent)) {
    return true
  }

  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

export const isApplePlatform = () => {
  if (typeof navigator === 'undefined') return false

  const platform = navigator.platform || ''
  const userAgent = navigator.userAgent || ''

  return /Mac|iPad|iPhone|iPod/.test(platform) || /iPad|iPhone|iPod/.test(userAgent)
}

export const isPrimaryModifierPressed = (event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey'>) => {
  if (isApplePlatform()) {
    return event.metaKey && !event.ctrlKey
  }

  return event.ctrlKey && !event.metaKey
}
