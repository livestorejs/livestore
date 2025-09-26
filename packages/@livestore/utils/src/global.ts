declare global {
  export type TODO<_Reason extends string = 'unknown'> = any
  export type UNUSED<_Reason extends string = 'unknown'> = any

  interface ImportMeta {
    readonly main: boolean
  }
}

export {}
