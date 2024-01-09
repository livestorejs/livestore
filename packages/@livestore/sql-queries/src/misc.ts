export type PartialIfNullable<T extends {}> = {
  [K in keyof T as T[K] extends null ? K : never]?: T[K]
} & {
  [K in keyof T as T[K] extends null ? never : K]: T[K]
}

/**
 * This is a tag function for tagged literals.
 * it lets us get syntax highlighting on SQL queries in VSCode, but
 * doesn't do anything at runtime.
 * Code copied from: https://esdiscuss.org/topic/string-identity-template-tag
 */
export const sql = (template: TemplateStringsArray, ...args: unknown[]): string => {
  let str = ''

  for (const [i, arg] of args.entries()) {
    str += template[i] + String(arg)
  }

  // eslint-disable-next-line unicorn/prefer-at
  return str + template[template.length - 1]
}

export const objectEntries = <T extends Record<string, any>>(obj: T): [keyof T & string, T[keyof T]][] =>
  Object.entries(obj) as [keyof T & string, T[keyof T]][]
