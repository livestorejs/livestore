declare global {
  export type TODO<_Reason extends string = 'unknown'> = any

  interface ImportMeta {
    readonly main: boolean
    readonly env: Record<string, string>
  }
}

export {}
