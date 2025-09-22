/// <reference types="vite/client" />
/// <reference path="./node_modules/@livestore/solid/index.d.ts" />
/// <reference path="./node_modules/solid-js/index.d.ts" />
/// <reference path="./node_modules/solid-js/jsx-runtime/index.d.ts" />

declare module '@livestore/solid' {
  import type { Accessor } from 'solid-js'

  export function query<TResult>(queryDef: unknown, initialValue: TResult): Accessor<TResult>

  export function getStore<TSchema>(options: {
    adapter: unknown
    schema: TSchema
    storeId: string
  }): Promise<Accessor<{ commit: (event: unknown) => unknown } | undefined>>
}

declare module 'solid-js' {
  export type Accessor<T> = () => T
  export type Setter<T> = (value: T) => T
  export type Component<P = {}> = (props: P) => any

  export interface ForProps<T, U> {
    each: readonly T[]
    children?: (item: T, index: () => number) => U
    fallback?: U
  }

  export function For<T, U>(props: ForProps<T, U>): any

  export function createSignal<T>(value: T): [Accessor<T>, Setter<T>]
  export function onCleanup(fn: () => void): void

  export interface HTMLAttributes<_T> {
    children?: any
    class?: string
    classList?: Record<string, boolean | undefined>
    onClick?: (event: any) => void
    onChange?: (event: any) => void
  }

  export interface InputHTMLAttributes<T> extends HTMLAttributes<T> {
    type?: string
    value?: string | number | readonly string[]
    checked?: boolean
  }

  export interface ButtonHTMLAttributes<T> extends HTMLAttributes<T> {
    type?: 'button' | 'submit' | 'reset'
  }
}

declare module 'solid-js/jsx-runtime' {
  export const Fragment: unique symbol
  export function jsx(type: any, props: any, key?: any): any
  export { jsx as jsxs, jsx as jsxDEV }
}
