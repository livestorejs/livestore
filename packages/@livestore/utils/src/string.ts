/** Indents a string each line by `n` characters (default: spaces) */
export const indent = (str: string, n: number, char = ' '): string =>
  str
    .split('\n')
    .map((line) => char.repeat(n) + line)
    .join('\n')
