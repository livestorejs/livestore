export const formatDate = (date?: Date): string => {
  if (!date) return ''

  // Get the day of the month (without any leading zero)
  const day = date.getDate()

  // Get the abbreviated month name (e.g., "Jan", "Feb", etc.)
  const month = date.toLocaleString('default', { month: 'short' })

  return `${day} ${month}`
}
