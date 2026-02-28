declare module 'virtual:starlight/user-config' {
  const config: import('@astrojs/starlight/types').StarlightConfig
  export default config
}

declare module 'virtual:starlight/plugin-translations' {
  const pluginTranslations: Record<string, Record<string, string>>
  export default pluginTranslations
}

declare module 'virtual:starlight/project-context' {
  const projectContext: {
    root: string
    srcDir: string
    trailingSlash: import('astro').AstroConfig['trailingSlash']
    build: {
      format: import('astro').AstroConfig['build']['format']
    }
    legacyCollections: boolean
  }
  export default projectContext
}

declare namespace StarlightApp {
  type I18n = {}
}
