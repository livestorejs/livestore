import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

import { chromium } from '@playwright/test'

import {
  decodeMeetingSchedule,
  getMeetingView,
  MEETING_PAGE_URL,
  MEETING_ROOM_URL,
} from '@local/shared/contributor-meeting'

import { clearFailure, recordFailure, type FailurePhase } from '../../../scripts/src/meetings/failure-status.ts'

let phase: FailurePhase = 'schedule'
await recordFailure(phase)
const source = await readFile(
  new URL('../../../context/05-contributing/02-community/meeting-schedule.json', import.meta.url),
  'utf8',
)
const schedule = decodeMeetingSchedule(JSON.parse(source))
const revision = createHash('sha256').update(source).digest('hex')
phase = 'browser'
await recordFailure(phase)
const browser = await chromium.launch({ headless: true })
try {
  phase = 'page'
  await recordFailure(phase)
  const page = await browser.newPage()
  let verified = false
  // Cover the raw-file cache window without multiplying slow navigation timeouts.
  const deadline = Date.now() + 6 * 60 * 1000
  const remaining = () => Math.max(1, deadline - Date.now())
  while (Date.now() < deadline) {
    try {
      await page.goto(MEETING_PAGE_URL, { waitUntil: 'domcontentloaded', timeout: Math.min(30000, remaining()) })
      await page
        .locator(`contributor-meetings[data-meeting-state="ready"][data-schedule-revision="${revision}"]`)
        .waitFor({ timeout: Math.min(20000, remaining()) })
      const expected = getMeetingView(schedule, new Date()).upcoming
      const shown = await page.locator('[data-meeting-id]').evaluateAll((elements) =>
        elements.map((element) => ({
          id: element.getAttribute('data-meeting-id'),
          start: element.querySelector('time')?.getAttribute('datetime'),
        })),
      )
      if (
        shown.length !== 2 ||
        shown.some((item, index) => item.id !== expected[index]?.id || item.start !== expected[index]?.start) === true
      ) {
        throw new Error('Published page rendered unexpected meeting dates')
      }
      verified = true
      break
    } catch {
      if (Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, Math.min(45000, remaining())))
    }
  }
  if (verified === false)
    throw new Error('Production meeting page did not render this schedule revision within the cache-refresh window')
  phase = 'room'
  await recordFailure(phase)
  const room = await fetch(MEETING_ROOM_URL, { redirect: 'manual', signal: AbortSignal.timeout(15000) })
  const location = room.headers.get('location')
  if (
    room.status !== 302 ||
    location === null ||
    new URL(location).href !== 'https://riverside.com/studio/livestore?t=5e1a91673f40e01c9054'
  )
    throw new Error('Canonical room redirect is not the LiveStore Riverside Studio')
  if (schedule.calendarId === undefined) throw new Error('Public calendarId is required for the publication gate')
  phase = 'feed'
  await recordFailure(phase)
  const feed = await fetch(
    `https://calendar.google.com/calendar/ical/${encodeURIComponent(schedule.calendarId)}/public/basic.ics`,
    {
      signal: AbortSignal.timeout(15000),
    },
  )
  if (feed.ok === false || (await feed.text()).includes('BEGIN:VCALENDAR') === false)
    throw new Error('Calendar is not publicly subscribable')
  phase = 'receipt-write'
  await recordFailure(phase)
  const directory = new URL('../../../tmp/', import.meta.url)
  await mkdir(directory, { recursive: true })
  await writeFile(
    new URL('meeting-site-receipt.json', directory),
    JSON.stringify({ revision, url: MEETING_PAGE_URL, verifiedAt: Date.now() }),
  )
  console.log(`Verified production page, room redirect and public calendar for ${revision}`)
  await clearFailure()
} catch (error) {
  await recordFailure(phase, error)
  throw error
} finally {
  await browser.close()
}
