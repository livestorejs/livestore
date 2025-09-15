declare module 'virtual:starlight/mixedbread-config' {
  const config: {
    apiKey: string
    vectorStoreId: string
    maxResults?: number
    baseUrl?: string
    disableUserPersonalization?: boolean
  }
  export default config
}
