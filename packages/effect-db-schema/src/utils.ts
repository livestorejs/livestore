export type Prettify<T> = T extends infer U ? { [K in keyof U]: Prettify<U[K]> } : never
export type PrettifyFlat<T> = T extends infer U ? { [K in keyof U]: U[K] } : never

export type Nullable<T> = { [K in keyof T]: T[K] | null }
