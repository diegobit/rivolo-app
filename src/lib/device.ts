export const isIOS = () => {
  if (typeof navigator === 'undefined') return false

  const userAgent = navigator.userAgent || ''

  if (/iPad|iPhone|iPod/.test(userAgent)) {
    return true
  }

  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}
