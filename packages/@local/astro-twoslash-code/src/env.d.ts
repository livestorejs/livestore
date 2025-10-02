/// <reference types="astro/client" />

import type { TwoslashSnippetPayload } from '@local/astro-twoslash-code'
import type { AstroComponentFactory } from 'astro/runtime'

declare module '*.astro' {
  const Component: AstroComponentFactory
  export default Component
}

declare module '*?snippet' {
  const Component: AstroComponentFactory
  export const snippetData: TwoslashSnippetPayload
  export default Component
}

declare module '*?snippet-raw' {
  const payload: TwoslashSnippetPayload
  export default payload
}
