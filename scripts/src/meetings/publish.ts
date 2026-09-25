import { readFile } from 'node:fs/promises'

import { decodeMeetingSchedule, getMeetingView } from '@local/shared/contributor-meeting'
import { clearFailure, recordFailure, type FailurePhase } from '@local/shared/contributor-meeting-failure'

import { calendarClient, desiredCalendarEvent, planCalendar, serviceAccountToken } from './google-calendar.ts'
import { verifySiteReceipt } from './site-receipt.ts'

const schedulePath = new URL('../../../context/05-contributing/02-community/meeting-schedule.json', import.meta.url)
const args = process.argv.slice(2)
if (args.some((arg) => !['--apply', '--validate'].includes(arg)) === true)
  throw new Error('Usage: publish.ts [--validate | --apply]')
if (args.includes('--apply') === true && args.includes('--validate') === true)
  throw new Error('Choose --validate or --apply')

let phase: FailurePhase = 'schedule'
try {
  await recordFailure(phase)
  const source = await readFile(schedulePath, 'utf8')
  const schedule = decodeMeetingSchedule(JSON.parse(source))
  const now = new Date()
  const desired = getMeetingView(schedule, now).upcoming.map(desiredCalendarEvent)
  if (args.includes('--validate') === true) {
    console.log(JSON.stringify({ mode: 'validate', events: desired }, null, 2))
  } else {
    if (schedule.calendarId === undefined)
      throw new Error('Provision the public calendar and set calendarId in meeting-schedule.json first')
    if (args.includes('--apply') === true) {
      phase = 'receipt'
      await recordFailure(phase)
      const receipt: unknown = JSON.parse(
        await readFile(new URL('../../../tmp/meeting-site-receipt.json', import.meta.url), 'utf8'),
      )
      verifySiteReceipt(receipt, source, now)
    }
    phase = 'authorization'
    await recordFailure(phase)
    const key = process.env.MEETING_GOOGLE_SERVICE_ACCOUNT_JSON
    if (key === undefined) throw new Error('MEETING_GOOGLE_SERVICE_ACCOUNT_JSON is required')
    const client = calendarClient(schedule.calendarId, await serviceAccountToken(key))
    phase = 'calendar-list'
    await recordFailure(phase)
    const desiredIds = desired.map(({ id }) => id)
    const existing = await client.list(now, desiredIds)
    // A reschedule can move an already-published future event into history.
    // Update that identity once; never backfill missing historical meetings.
    const historical = getMeetingView(schedule, now, new Set(existing.map(({ id }) => id))).retainedHistory.map(
      desiredCalendarEvent,
    )
    const publication = [...desired, ...historical]
    const actions = planCalendar(publication, existing)
    console.log(JSON.stringify({ mode: args.includes('--apply') === true ? 'apply' : 'plan', actions }, null, 2))
    if (args.includes('--apply') === true) {
      phase = 'calendar-apply'
      await recordFailure(phase)
      await client.apply(actions)
      phase = 'calendar-readback'
      await recordFailure(phase)
      const remaining = planCalendar(
        publication,
        await client.list(
          now,
          publication.map(({ id }) => id),
        ),
      )
      if (remaining.length !== 0) throw new Error('Google Calendar read-back differs from the desired meetings')
      console.log(`Verified ${desired.length} upcoming Google events`)
    }
  }
  await clearFailure()
} catch (error) {
  await recordFailure(phase, error)
  console.error(error instanceof Error ? error.message : 'Meeting publication failed')
  process.exitCode = 1
}
