/// <reference types="astro/client" />

declare module '*.astro' {
  const Component: import('astro/runtime').AstroComponentFactory
  export default Component
}
