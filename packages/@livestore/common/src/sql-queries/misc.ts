export const objectEntries = <T extends Record<string, any>>(obj: T): [keyof T & string, T[keyof T]][] =>
  Object.entries(obj) as [keyof T & string, T[keyof T]][]
