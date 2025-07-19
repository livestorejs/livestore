declare global {
  export type TODO<_Reason extends string = 'unknown'> = any

  interface ImportMeta {
    readonly main: boolean
    // @ts-ignore - temporary ignore so that we can see if tests pass
    readonly env: Record<string, string>
  }
}

export {}
