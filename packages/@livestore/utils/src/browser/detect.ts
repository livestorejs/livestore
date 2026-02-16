export type DetectedBrowser = 'Something' | 'Opera' | 'Chrome' | 'Safari' | 'Firefox' | 'Edge' | 'Browser'

export const detectBrowserName: () => DetectedBrowser = () => {
  if (navigator.userAgent == null) {
    return 'Something'
  }

  const isOpera = navigator.userAgent.includes('OP')
  const isChrome = navigator.userAgent.includes('Chrome') && !isOpera
  const isSafari = navigator.userAgent.includes('Safari') && !isChrome
  const isFirefox = navigator.userAgent.includes('Firefox')
  const isEdge = navigator.userAgent.includes('Edg') || navigator.userAgent.includes('Trident')

  // TODO: also parse out version

  if (isOpera === true) {
    return 'Opera'
  }
  if (isChrome === true) {
    return 'Chrome'
  }
  if (isSafari === true) {
    return 'Safari'
  }
  if (isFirefox === true) {
    return 'Firefox'
  }
  if (isEdge === true) {
    return 'Edge'
  }
  return 'Browser'
}
