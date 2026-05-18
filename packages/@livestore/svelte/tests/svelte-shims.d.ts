/// <reference types="svelte" />

declare module '*.svelte' {
  const component: import('svelte').Component
  export default component
}
