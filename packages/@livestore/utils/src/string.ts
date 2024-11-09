export const lowercaseFirstChar = (str: string) => str.charAt(0).toLowerCase() + str.slice(1)
export const uppercaseFirstChar = (str: string) => str.charAt(0).toUpperCase() + str.slice(1)

/** Indents a string each line by `n` characters (default: spaces) */
export const indent = (str: string, n: number, char = ' '): string =>
  str
    .split('\n')
    .map((line) => char.repeat(n) + line)
    .join('\n')
