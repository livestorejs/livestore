export type DetectedBrowser = 'Something' | 'Opera' | 'Chrome' | 'Safari' | 'Firefox' | 'Edge' | 'Browser'

export const detectBrowserName: () => DetectedBrowser = () => {
  if (!navigator.userAgent) {
    return 'Something'
  }

  const isOpera = navigator.userAgent.includes('OP')
  const isChrome = navigator.userAgent.includes('Chrome') && !isOpera
  const isSafari = navigator.userAgent.includes('Safari') && !isChrome
  const isFirefox = navigator.userAgent.includes('Firefox')
  const isEdge = navigator.userAgent.includes('Edg') || navigator.userAgent.includes('Trident')

  // TODO: also parse out version

  if (isOpera) {
    return 'Opera'
  }
  if (isChrome) {
    return 'Chrome'
  }
  if (isSafari) {
    return 'Safari'
  }
  if (isFirefox) {
    return 'Firefox'
  }
  if (isEdge) {
    return 'Edge'
  }
  return 'Browser'
}
