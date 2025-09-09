export function toSentenceCase(str: string): string {
  if (!str) return str // Handle empty string
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
}
