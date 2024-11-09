export const getAppId = () => {
  if (typeof window === 'undefined') return 'unused'

  const searchParams = new URLSearchParams(window.location.search)
  const appId = searchParams.get('appId')
  if (appId !== null) return appId

  const newAppId = crypto.randomUUID()
  searchParams.set('appId', newAppId)

  window.location.search = searchParams.toString()
}
