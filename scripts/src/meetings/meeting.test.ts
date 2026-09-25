import { createHash } from 'node:crypto'
import { createServer } from 'node:http'

import { describe, expect, test } from 'vitest'

import {
  decodeMeetingSchedule,
  getMeetingView,
  MEETING_PAGE_URL,
  MEETING_ROOM_URL,
} from '@local/shared/contributor-meeting'

import {
  calendarClient,
  desiredCalendarEvent,
  MEETING_OWNER,
  planCalendar,
  serviceAccountToken,
} from './google-calendar.ts'
import type { CalendarEvent } from './google-calendar.ts'
import { verifySiteReceipt } from './site-receipt.ts'

const base = {
  version: 1,
  anchor: { occurrence: 0, date: '2026-09-24' },
  intervalDays: 14,
  localStart: '19:00',
  durationMinutes: 60,
  timeZone: 'Europe/Berlin',
  changes: [],
}
const now = new Date('2026-09-25T12:00:00Z')
const schedule = decodeMeetingSchedule(base)
const desired = getMeetingView(schedule, now).upcoming.map(desiredCalendarEvent)

describe('publication gate', () => {
  const source = JSON.stringify(base)
  const receipt = {
    revision: createHash('sha256').update(source).digest('hex'),
    url: MEETING_PAGE_URL,
    verifiedAt: now.getTime(),
  }
  test('accepts a fresh production receipt for the exact source', () => {
    expect(() => verifySiteReceipt(receipt, source, now)).not.toThrow()
  })
  test.each([
    null,
    {},
    { ...receipt, revision: 'older-source' },
    { ...receipt, url: 'http://localhost:4321' },
    { ...receipt, verifiedAt: now.getTime() - 900001 },
    { ...receipt, verifiedAt: now.getTime() + 1 },
    { ...receipt, verifiedAt: Number.NaN },
    { ...receipt, verifiedAt: Number.POSITIVE_INFINITY },
  ])('rejects unusable publication receipts %#', (invalid) => {
    expect(() => verifySiteReceipt(invalid, source, now)).toThrow('production-page check')
  })
  test('malformed credentials never expose their input', async () => {
    const secret = 'PRIVATE-CREDENTIAL-CONTENT'
    await expect(serviceAccountToken(`{"private_key":"${secret}"`)).rejects.toThrow(
      'Invalid Google service-account JSON',
    )
    await expect(serviceAccountToken(JSON.stringify({ private_key: secret }))).rejects.toThrow(
      'Invalid Google service-account JSON',
    )
    await expect(
      serviceAccountToken(JSON.stringify({ client_email: 'publisher@example.com', private_key: secret })),
    ).rejects.toThrow('Invalid Google service-account signing key')
  })
})

describe('contributor schedule', () => {
  test('selects October 8 and 22 at 19:00 Berlin', () => {
    expect(getMeetingView(schedule, now).upcoming.map(({ start }) => start)).toEqual([
      '2026-10-08T17:00:00.000Z',
      '2026-10-22T17:00:00.000Z',
    ])
  })
  test('retains wall time over autumn and spring DST', () => {
    expect(getMeetingView(schedule, new Date('2026-10-23')).upcoming[0]?.start).toBe('2026-11-05T18:00:00.000Z')
    expect(getMeetingView(schedule, new Date('2027-03-29')).upcoming[0]?.start).toBe('2027-04-08T17:00:00.000Z')
  })
  test('retains a running meeting until its end, then replenishes', () => {
    expect(getMeetingView(schedule, new Date('2026-10-08T17:30:00Z')).upcoming[0]?.occurrence).toBe(1)
    expect(getMeetingView(schedule, new Date('2026-10-08T18:00:00Z')).upcoming[0]?.occurrence).toBe(2)
  })
  test('a move changes later cadence and time while preserving IDs', () => {
    const moved = decodeMeetingSchedule({
      ...base,
      changes: [
        {
          kind: 'reschedule',
          occurrence: 1,
          date: '2026-10-09',
          localStart: '20:00',
          note: 'Host unavailable on Thursday.',
        },
      ],
    })
    const actual = getMeetingView(moved, now)
    expect(actual.upcoming.map(({ id }) => id)).toEqual(desired.map(({ id }) => id))
    expect(actual.upcoming.map(({ start }) => start)).toEqual(['2026-10-09T18:00:00.000Z', '2026-10-23T18:00:00.000Z'])
    expect(actual.notices[0]?.date).toBe('2026-10-08')
    expect(actual.upcoming.map(({ note }) => note)).toEqual(['Host unavailable on Thursday.', undefined])
    expect(getMeetingView(moved, new Date('2026-10-24')).upcoming.every(({ note }) => note === undefined)).toBe(true)
  })
  test('cancellation requires explicit dates and resumes from the second', () => {
    const cancelled = decodeMeetingSchedule({
      ...base,
      changes: [{ kind: 'cancel', occurrence: 1, nextDates: ['2026-10-15', '2026-11-05'], note: 'Travel conflict.' }],
    })
    const actual = getMeetingView(cancelled, now)
    expect(actual.upcoming.map(({ occurrence, date }) => [occurrence, date])).toEqual([
      [2, '2026-10-15'],
      [3, '2026-11-05'],
    ])
    expect(actual.notices).toEqual([{ kind: 'cancel', date: '2026-10-08', note: 'Travel conflict.' }])
    expect(getMeetingView(cancelled, new Date('2026-11-06')).upcoming[0]?.date).toBe('2026-11-19')
    expect(getMeetingView(cancelled, new Date('2026-10-09')).notices).toEqual([])
    expect(actual.upcoming.map(({ note }) => note)).toEqual(['Travel conflict.', 'Travel conflict.'])
    expect(getMeetingView(cancelled, new Date('2026-11-06')).upcoming.every(({ note }) => note === undefined)).toBe(
      true,
    )
  })
  test.each([
    { ...base, version: 2 },
    { ...base, anchor: { occurrence: 1, date: '2026-09-24' } },
    { ...base, anchor: { occurrence: 0, date: '2026-02-30' } },
    { ...base, changes: [{ kind: 'reschedule', occurrence: 1, date: '2026-10-09', note: '' }] },
    { ...base, changes: [{ kind: 'cancel', occurrence: 1, nextDates: ['2026-10-22'], note: 'Unavailable.' }] },
    {
      ...base,
      changes: [{ kind: 'cancel', occurrence: 1, nextDates: ['2026-10-01', '2026-10-22'], note: 'Unavailable.' }],
    },
    { ...base, changes: [{ kind: 'reschedule', occurrence: 1, date: '2026-09-23', note: 'Earlier.' }] },
    { ...base, anchor: { occurrence: 0, date: '2026-10-25' }, localStart: '02:30' },
    { ...base, anchor: { occurrence: 0, date: '2027-03-28' }, localStart: '02:30' },
  ])('rejects invalid or ambiguous schedules %#', (input) => expect(() => decodeMeetingSchedule(input)).toThrow())
})

describe('calendar reconciliation', () => {
  test('moves published future occurrences into history without deleting or backfilling history', () => {
    const currentTime = new Date('2026-10-07T12:00:00Z')
    const moved = decodeMeetingSchedule({
      ...base,
      changes: [{ kind: 'reschedule', occurrence: 1, date: '2026-10-06', note: 'Met earlier.' }],
    })
    const existing = desired.map((event) => ({ ...event, etag: '"v1"' }))
    const view = getMeetingView(moved, currentTime, new Set(existing.map(({ id }) => id)))
    expect(view.upcoming).toHaveLength(2)
    expect(view.retainedHistory.map(({ id }) => id)).toEqual([desired[0]?.id])
    const publication = [...view.upcoming, ...view.retainedHistory].map(desiredCalendarEvent)
    const actions = planCalendar(publication, existing)
    expect(actions.map(({ kind }) => kind)).toEqual(['update', 'create', 'update'])
    expect(actions.at(-1)).toMatchObject({
      kind: 'update',
      event: { id: desired[0]?.id, start: { dateTime: '2026-10-06T17:00:00.000Z' } },
    })
    expect(planCalendar(publication, publication)).toEqual([])
    // Future-only listing on later runs omits the now historical event.
    const future = view.upcoming.map(desiredCalendarEvent)
    const repeated = getMeetingView(moved, currentTime, new Set(future.map(({ id }) => id)))
    expect(repeated.retainedHistory).toEqual([])
    expect(planCalendar(repeated.upcoming.map(desiredCalendarEvent), future)).toEqual([])
    expect(getMeetingView(moved, currentTime).retainedHistory).toEqual([])
    // Explicit cancellations still remove the formerly published occurrence.
    const cancelled = decodeMeetingSchedule({
      ...base,
      changes: [{ kind: 'cancel', occurrence: 1, nextDates: ['2026-10-22', '2026-11-05'], note: 'Cancelled.' }],
    })
    const cancellationView = getMeetingView(cancelled, currentTime, new Set(existing.map(({ id }) => id)))
    expect(cancellationView.retainedHistory).toEqual([])
    expect(planCalendar(cancellationView.upcoming.map(desiredCalendarEvent), existing)).toContainEqual({
      kind: 'delete',
      id: desired[0]?.id,
      etag: '"v1"',
    })
  })
  test('creates exactly two events and repeated runs are no-ops', () => {
    expect(planCalendar(desired, []).map(({ kind }) => kind)).toEqual(['create', 'create'])
    expect(planCalendar(desired, desired)).toEqual([])
    expect(desired[0]?.description).toContain(MEETING_PAGE_URL)
    expect(desired[0]?.location).toBe(MEETING_ROOM_URL)
    expect(desired[0]).not.toHaveProperty('attendees')
    expect(desired[0]).not.toHaveProperty('recurrence')
  })
  test('normalizes Google timezone offsets for comparison', () => {
    const existing = desired.map((event) => ({
      ...event,
      start: {
        dateTime: event.id.endsWith('1') === true ? '2026-10-08T19:00:00+02:00' : '2026-10-22T19:00:00+02:00',
        timeZone: 'Europe/Berlin',
      },
    }))
    expect(planCalendar(desired, existing)).toEqual([])
  })
  test('moves in place and removes obsolete managed future events', () => {
    const changed = decodeMeetingSchedule({
      ...base,
      changes: [{ kind: 'reschedule', occurrence: 1, date: '2026-10-09', note: 'Travel.' }],
    })
    const existing = desired.map((event) => ({ ...event, etag: '"v1"' }))
    expect(
      planCalendar(getMeetingView(changed, now).upcoming.map(desiredCalendarEvent), existing).map(({ kind }) => kind),
    ).toEqual(['update', 'update'])
    expect(planCalendar(desired.slice(1), existing)).toEqual([{ kind: 'delete', id: desired[0]?.id, etag: '"v1"' }])
  })
  test('rejects unowned events and missing concurrency tokens', () => {
    expect(() => planCalendar(desired, [{ id: desired[0]?.id ?? '' }])).toThrow('unowned')
    expect(() => planCalendar([], desired)).toThrow('concurrency')
  })
  test('finds moved past events and restores cancelled stable identities', async () => {
    const first = desired[0]
    const second = desired[1]
    if (first === undefined || second === undefined) throw new Error('Missing desired events')
    const cancelled = { ...second, status: 'cancelled', etag: '"cancelled"' }
    const existing = [{ ...first, start: { dateTime: '2026-09-24T17:00:00Z' }, etag: '"past"' }, cancelled]
    const requests: Array<{ method: string; body?: CalendarEvent }> = []
    const client = calendarClient('calendar', 'token', async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input)
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as CalendarEvent) : undefined
      requests.push({ method, ...(body === undefined ? {} : { body }) })
      if (url.pathname.endsWith('/events') === true) return Response.json({ items: [] })
      const event = existing.find(({ id }) => url.pathname.endsWith(`/${id}`))
      return event === undefined ? new Response('', { status: 404 }) : Response.json(event)
    })
    const actions = planCalendar(
      desired,
      await client.list(
        now,
        desired.map(({ id }) => id),
      ),
    )
    expect(actions.map(({ kind }) => kind)).toEqual(['update', 'update'])
    await client.apply(actions)
    expect(requests.filter(({ method }) => method === 'POST')).toEqual([])
    expect(requests.filter(({ method }) => method === 'PATCH').map(({ body }) => body?.status)).toEqual([
      'confirmed',
      'confirmed',
    ])
    expect(planCalendar([], [cancelled])).toEqual([])
  })
  test('missing desired identities are created but unowned identities fail closed', async () => {
    const missing = calendarClient('calendar', 'token', async (input) =>
      new URL(input instanceof Request ? input.url : input).pathname.endsWith('/events') === true
        ? Response.json({})
        : new Response('', { status: 404 }),
    )
    expect(
      planCalendar(
        desired,
        await missing.list(
          now,
          desired.map(({ id }) => id),
        ),
      ).map(({ kind }) => kind),
    ).toEqual(['create', 'create'])
    const unowned = calendarClient('calendar', 'token', async (input) =>
      new URL(input instanceof Request ? input.url : input).pathname.endsWith('/events') === true
        ? Response.json({ items: [] })
        : Response.json({ id: desired[0]?.id, status: 'cancelled' }),
    )
    await expect(
      unowned.list(
        now,
        desired.map(({ id }) => id),
      ),
    ).rejects.toThrow('unowned')
  })
  test('HTTP adapter applies creates, updates and deletes with bounded ownership and etags', async () => {
    const events = new Map<string, CalendarEvent>()
    const methods: string[] = []
    const server = createServer(async (request, response) => {
      methods.push(request.method ?? '')
      const url = new URL(request.url ?? '/', 'http://localhost')
      if (request.method === 'GET') {
        expect(url.searchParams.get('privateExtendedProperty')).toBe(`livestoreMeeting=${MEETING_OWNER}`)
        response.end(JSON.stringify({ items: [...events.values()] }))
        return
      }
      if (request.method === 'PATCH' || request.method === 'DELETE') expect(request.headers['if-match']).toBe('"v1"')
      if (request.method === 'DELETE') {
        events.delete(url.pathname.split('/').at(-1) ?? '')
        response.statusCode = 204
        response.end()
        return
      }
      let body = ''
      for await (const chunk of request) body += chunk.toString()
      const event = JSON.parse(body) as CalendarEvent
      events.set(event.id, { ...event, etag: '"v1"' })
      response.end(JSON.stringify(event))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('Missing test server address')
      const transport: typeof fetch = (input, init) => {
        const requested = new URL(input instanceof Request ? input.url : input)
        return fetch(`http://127.0.0.1:${address.port}${requested.pathname}${requested.search}`, init)
      }
      const client = calendarClient('public@example.com', 'test-token', transport)
      expect(methods).toEqual([])
      const preview = planCalendar(desired, await client.list(now))
      expect(methods).toEqual(['GET'])
      await client.apply(preview)
      expect(planCalendar(desired, await client.list(now))).toEqual([])
      const changed = desired.map((event) => ({ ...event, description: 'Updated reason' }))
      await client.apply(planCalendar(changed, await client.list(now)))
      await client.apply(planCalendar([], await client.list(now)))
      expect(events.size).toBe(0)
      expect(methods.filter((method) => method === 'POST')).toHaveLength(2)
      expect(methods.filter((method) => method === 'PATCH')).toHaveLength(2)
      expect(methods.filter((method) => method === 'DELETE')).toHaveLength(2)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error !== undefined ? reject(error) : resolve())),
      )
    }
  })
  test('permission and concurrency failures remain visible', async () => {
    const forbidden = calendarClient('calendar', 'token', async () => new Response('', { status: 403 }))
    await expect(forbidden.list(now)).rejects.toThrow('(403)')
    const conflict = calendarClient('calendar', 'token', async () => new Response('', { status: 412 }))
    await expect(conflict.apply([{ kind: 'delete', id: 'lscontrib00000001', etag: '"old"' }])).rejects.toThrow('(412)')
  })
})
