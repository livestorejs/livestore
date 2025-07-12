// Based on https://stackoverflow.com/a/7616484
export const hashCode = (str: string) => {
  let hash = 0
  let i: number
  let chr: number
  if (str.length === 0) return hash
  for (i = 0; i < str.length; i++) {
    chr = str.charCodeAt(i)
    hash = (hash << 5) - hash + chr
    hash = Math.trunc(hash) // Convert to 32bit integer
  }
  return hash
}
