export const MEETING_PAGE_URL = 'https://docs.livestore.dev/misc/contributor-sync/'
export const MEETING_ROOM_URL = 'https://docs.livestore.dev/meet'
export const MEETING_SCHEDULE_URL =
  'https://raw.githubusercontent.com/livestorejs/livestore/main/context/05-contributing/02-community/meeting-schedule.json'

export type MeetingChange =
  | { kind: 'reschedule'; occurrence: number; date: string; note: string; localStart?: string }
  | { kind: 'cancel'; occurrence: number; nextDates: [string, string]; note: string }

export type MeetingSchedule = {
  version: 1
  anchor: { occurrence: number; date: string }
  intervalDays: 14
  localStart: string
  durationMinutes: number
  timeZone: 'Europe/Berlin'
  calendarId?: string
  changes: MeetingChange[]
}

export type MeetingOccurrence = {
  id: string
  occurrence: number
  date: string
  start: string
  end: string
  note?: string
}

export type MeetingNotice = { kind: 'reschedule' | 'cancel'; date: string; newDate?: string; note: string }

export class MeetingScheduleError extends Error {
  override name = 'MeetingScheduleError'
}

export const decodeMeetingSchedule = (input: unknown): MeetingSchedule => {
  const value = record(input, 'schedule')
  const anchor = record(value.anchor, 'anchor')
  if (value.version !== 1 || value.intervalDays !== 14 || value.timeZone !== 'Europe/Berlin') {
    throw new MeetingScheduleError('Expected schedule version 1, intervalDays 14 and Europe/Berlin')
  }
  const localStart = string(value.localStart, 'localStart')
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(localStart) === false) throw new MeetingScheduleError('Invalid localStart')
  const durationMinutes = integer(value.durationMinutes, 'durationMinutes')
  if (durationMinutes < 1 || durationMinutes > 240) throw new MeetingScheduleError('Duration must be 1–240 minutes')
  if (Array.isArray(value.changes) === false || value.changes.length > 100)
    throw new MeetingScheduleError('Invalid changes')
  const changes = value.changes.map((inputChange): MeetingChange => {
    const change = record(inputChange, 'change')
    const occurrence = integer(change.occurrence, 'occurrence')
    const note = string(change.note, 'note').trim()
    if (note.length === 0 || note.length > 280)
      throw new MeetingScheduleError('Changes need a public note of 1–280 characters')
    if (change.kind === 'reschedule') {
      const movedTime = change.localStart === undefined ? undefined : string(change.localStart, 'localStart')
      if (movedTime !== undefined && /^([01]\d|2[0-3]):[0-5]\d$/.test(movedTime) === false)
        throw new MeetingScheduleError('Invalid moved localStart')
      return {
        kind: 'reschedule',
        occurrence,
        date: date(change.date),
        note,
        ...(movedTime === undefined ? {} : { localStart: movedTime }),
      }
    }
    if (change.kind === 'cancel' && Array.isArray(change.nextDates) === true && change.nextDates.length === 2) {
      const first = date(change.nextDates[0])
      const second = date(change.nextDates[1])
      if (second <= first) throw new MeetingScheduleError('Cancellation replacement dates must be increasing')
      return { kind: 'cancel', occurrence, nextDates: [first, second], note }
    }
    throw new MeetingScheduleError('A cancellation requires exactly two nextDates')
  })
  const anchorOccurrence = integer(anchor.occurrence, 'anchor.occurrence')
  if (anchorOccurrence !== 0) throw new MeetingScheduleError('The identity anchor must be occurrence zero')
  let previousChangeEnd = anchorOccurrence - 1
  for (const change of changes) {
    if (change.occurrence <= previousChangeEnd)
      throw new MeetingScheduleError('Changes must be ordered and not overlap')
    previousChangeEnd = change.occurrence + (change.kind === 'cancel' ? 2 : 0)
  }
  const calendarId = value.calendarId === undefined ? undefined : string(value.calendarId, 'calendarId')
  if (calendarId !== undefined && /^[a-zA-Z0-9._@-]+$/.test(calendarId) === false)
    throw new MeetingScheduleError('Invalid calendarId')
  const schedule: MeetingSchedule = {
    version: 1,
    anchor: { occurrence: anchorOccurrence, date: date(anchor.date) },
    intervalDays: 14,
    localStart,
    durationMinutes,
    timeZone: 'Europe/Berlin',
    changes,
    ...(calendarId === undefined ? {} : { calendarId }),
  }
  validateCadence(schedule)
  getMeetingView(schedule, new Date(`${schedule.anchor.date}T00:00:00Z`))
  return schedule
}

export const getMeetingView = (
  schedule: MeetingSchedule,
  now: Date,
  retainIds: ReadonlySet<string> = new Set(),
): { upcoming: MeetingOccurrence[]; notices: MeetingNotice[]; retainedHistory: MeetingOccurrence[] } => {
  if (Number.isFinite(now.getTime()) === false) throw new MeetingScheduleError('Invalid current time')
  const upcoming: MeetingOccurrence[] = []
  const notices: MeetingNotice[] = []
  const retainedHistory: MeetingOccurrence[] = []
  let cursorDate = schedule.anchor.date
  let localStart = schedule.localStart
  let previousDate: string | undefined
  const replacements = new Map<number, string>()
  const replacementNotes = new Map<number, string>()
  const changes = new Map(schedule.changes.map((change) => [change.occurrence, change]))
  const lastChange = schedule.changes.at(-1)?.occurrence ?? schedule.anchor.occurrence
  for (let occurrence = schedule.anchor.occurrence; occurrence < schedule.anchor.occurrence + 10000; occurrence++) {
    cursorDate = replacements.get(occurrence) ?? cursorDate
    const originalDate = cursorDate
    const change = changes.get(occurrence)
    let note = replacementNotes.get(occurrence)
    if (change !== undefined) {
      note = change.note
      if (change.kind === 'cancel') {
        replacements.set(occurrence + 1, change.nextDates[0])
        replacements.set(occurrence + 2, change.nextDates[1])
        replacementNotes.set(occurrence + 1, note)
        replacementNotes.set(occurrence + 2, note)
        if (change.nextDates[0] <= originalDate)
          throw new MeetingScheduleError('Cancellation replacement dates must follow the cancelled date')
        if (meetingEnd({ ...schedule, localStart }, originalDate) > now.getTime())
          notices.push({ kind: 'cancel', date: originalDate, note })
        cursorDate = addDays(cursorDate, schedule.intervalDays)
        continue
      }
      cursorDate = change.date
      const originalEnd = meetingEnd({ ...schedule, localStart }, originalDate)
      localStart = change.localStart ?? localStart
      if (Math.max(originalEnd, meetingEnd({ ...schedule, localStart }, cursorDate)) > now.getTime()) {
        notices.push({ kind: 'reschedule', date: originalDate, newDate: cursorDate, note })
      }
    }
    if (previousDate !== undefined && cursorDate <= previousDate)
      throw new MeetingScheduleError('Meeting dates must stay increasing')
    previousDate = cursorDate
    const start = localInstant(cursorDate, localStart, schedule.timeZone)
    const end = start + schedule.durationMinutes * 60000
    const id = `lscontrib${occurrence.toString(16).padStart(8, '0')}`
    const retainHistory = end <= now.getTime() && retainIds.has(id) === true
    if ((end > now.getTime() && upcoming.length < 2) || retainHistory === true) {
      const meeting = {
        id,
        occurrence,
        date: cursorDate,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        ...(note === undefined ? {} : { note }),
      }
      if (retainHistory === true) retainedHistory.push(meeting)
      else upcoming.push(meeting)
    }
    if (upcoming.length === 2 && occurrence >= lastChange + 2) return { upcoming, notices, retainedHistory }
    cursorDate = addDays(cursorDate, schedule.intervalDays)
  }
  throw new MeetingScheduleError('Schedule exceeds the supported 10,000-occurrence horizon')
}

const record = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value) === true)
    throw new MeetingScheduleError(`Invalid ${label}`)
  return value as Record<string, unknown>
}

const string = (value: unknown, label: string): string => {
  if (typeof value !== 'string') throw new MeetingScheduleError(`Invalid ${label}`)
  return value
}

const integer = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || Number.isSafeInteger(value) === false || value < 0 || value > 1000000) {
    throw new MeetingScheduleError(`Invalid ${label}`)
  }
  return value
}

const date = (value: unknown): string => {
  const text = string(value, 'date')
  if (
    /^20\d\d-\d\d-\d\d$/.test(text) === false ||
    Number.isFinite(Date.parse(`${text}T00:00:00Z`)) === false ||
    new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) !== text
  )
    throw new MeetingScheduleError(`Invalid date: ${text}`)
  return text
}

const addDays = (value: string, days: number): string =>
  new Date(Date.parse(`${value}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)

const localInstant = (day: string, time: string, timeZone: string): number => {
  const wall = Date.parse(`${day}T${time}:00Z`)
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const asWall = (instant: number): number => Date.parse(`${formatter.format(instant).replace(' ', 'T')}:00Z`)
  let result = wall
  for (let attempt = 0; attempt < 3; attempt++) result += wall - asWall(result)
  if (asWall(result) !== wall || asWall(result - 3600000) === wall || asWall(result + 3600000) === wall) {
    throw new MeetingScheduleError('Meeting time is missing or ambiguous across a daylight-saving transition')
  }
  return result
}

const meetingEnd = (schedule: MeetingSchedule, day: string): number =>
  localInstant(day, schedule.localStart, schedule.timeZone) + schedule.durationMinutes * 60000

// Berlin has missing/ambiguous wall times only in the 02:00 hour on the
// last Sunday of March/October. Inspect the entire bounded cadence cheaply,
// invoking Intl only for those candidate dates (including later cadence changes).
const validateCadence = (schedule: MeetingSchedule): void => {
  let day = schedule.anchor.date
  let time = schedule.localStart
  const changes = new Map(schedule.changes.map((change) => [change.occurrence, change]))
  const replacements = new Map<number, string>()
  if (schedule.changes.some((change) => change.occurrence + (change.kind === 'cancel' ? 2 : 0) >= 10000) === true)
    throw new MeetingScheduleError('Schedule exceeds the supported 10,000-occurrence horizon')
  if (
    time.startsWith('02:') === false &&
    schedule.changes.some((change) => change.kind === 'reschedule' && change.localStart?.startsWith('02:') === true) ===
      false
  )
    return
  for (let occurrence = 0; occurrence < 10000; occurrence++) {
    day = replacements.get(occurrence) ?? day
    const change = changes.get(occurrence)
    if (change?.kind === 'cancel') {
      replacements.set(occurrence + 1, change.nextDates[0])
      replacements.set(occurrence + 2, change.nextDates[1])
    } else {
      if (change?.kind === 'reschedule') {
        day = change.date
        time = change.localStart ?? time
      }
      if (time.startsWith('02:') === true) {
        const instant = new Date(`${day}T00:00:00Z`)
        if (
          (instant.getUTCMonth() === 2 || instant.getUTCMonth() === 9) &&
          instant.getUTCDay() === 0 &&
          instant.getUTCDate() >= 25
        )
          localInstant(day, time, schedule.timeZone)
      }
    }
    day = addDays(day, schedule.intervalDays)
  }
}
