export const difference = <T>(a: Set<T>, b: Set<T>) => {
  const diff = new Set<T>()
  for (const item of a) {
    if (!b.has(item)) {
      diff.add(item)
    }
  }

  return diff
}
