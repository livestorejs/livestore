export const minuteInMs = 1000 * 60

export const time = {
  ms: 1,
  sec: 1000,
  min: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
}

/** Returns a string of format `m:ss` / `mm:ss` / `h:mm:ss` / ... */
export const msAsTimeString = (ms: number) => {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const remainingSeconds = (seconds % 60).toString().padStart(2, '0')
  const remainingMinutes = hours > 0 ? (minutes % 60).toString().padStart(2, '0') : minutes % 60

  const timeString = [hours > 0 ? `${hours}:` : '', `${remainingMinutes}:`, `${remainingSeconds}`]
    .filter((val) => val !== '')
    .join('')

  return timeString
}
