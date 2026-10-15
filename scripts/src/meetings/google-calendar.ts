import { createSign } from 'node:crypto'

import { MEETING_CHAT_URL, MEETING_PAGE_URL, MEETING_ROOM_URL } from '@local/shared/contributor-meeting'
import type { MeetingOccurrence } from '@local/shared/contributor-meeting'

export const MEETING_OWNER = 'livestore-contributor-sync-v1'

export type CalendarEvent = {
  id: string
  etag?: string
  status?: string
  summary?: string
  description?: string
  location?: string
  start?: { dateTime?: string; timeZone?: string }
  end?: { dateTime?: string; timeZone?: string }
  extendedProperties?: { private?: Record<string, string> }
}

export type CalendarAction =
  | { kind: 'create'; event: CalendarEvent }
  | { kind: 'update'; event: CalendarEvent; etag: string }
  | { kind: 'delete'; id: string; etag: string }

export class CalendarPublishError extends Error {
  override name = 'CalendarPublishError'
}

export const desiredCalendarEvent = (meeting: MeetingOccurrence): CalendarEvent => ({
  id: meeting.id,
  status: 'confirmed',
  summary: 'LiveStore Contributor Sync',
  description: [
    `Current meeting information: ${MEETING_PAGE_URL}`,
    `Join the conversation: ${MEETING_ROOM_URL}`,
    `Contributor chat: ${MEETING_CHAT_URL}`,
    'Check the meeting page before joining. Saved one-off calendar copies do not update automatically; subscriptions may refresh slowly.',
    ...(meeting.note === undefined ? [] : [`Schedule note: ${meeting.note}`]),
  ].join('\n\n'),
  location: MEETING_ROOM_URL,
  start: { dateTime: meeting.start, timeZone: 'Europe/Berlin' },
  end: { dateTime: meeting.end, timeZone: 'Europe/Berlin' },
  extendedProperties: { private: { livestoreMeeting: MEETING_OWNER } },
})

export const planCalendar = (desired: CalendarEvent[], existing: CalendarEvent[]): CalendarAction[] => {
  const actions: CalendarAction[] = []
  for (const event of desired) {
    const current = existing.find((candidate) => candidate.id === event.id)
    if (current === undefined) {
      actions.push({ kind: 'create', event })
    } else {
      requireOwned(current)
      if (sameEvent(current, event) === false) actions.push({ kind: 'update', event, etag: requireEtag(current) })
    }
  }
  for (const event of existing) {
    requireOwned(event)
    if (event.status !== 'cancelled' && desired.some((candidate) => candidate.id === event.id) === false)
      actions.push({ kind: 'delete', id: event.id, etag: requireEtag(event) })
  }
  return actions
}

export const serviceAccountToken = async (credentials: string): Promise<string> => {
  let key: unknown
  try {
    key = JSON.parse(credentials)
  } catch {
    throw new CalendarPublishError('Invalid Google service-account JSON')
  }
  if (
    typeof key !== 'object' ||
    key === null ||
    !('client_email' in key) ||
    !('private_key' in key) ||
    typeof key.client_email !== 'string' ||
    typeof key.private_key !== 'string'
  ) {
    throw new CalendarPublishError('Invalid Google service-account JSON')
  }
  const issued = Math.floor(Date.now() / 1000)
  const payload = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/calendar.events',
    aud: 'https://oauth2.googleapis.com/token',
    iat: issued,
    exp: issued + 3600,
  })}`
  let signature: string
  try {
    signature = createSign('RSA-SHA256').update(payload).sign(key.private_key, 'base64url')
  } catch {
    throw new CalendarPublishError('Invalid Google service-account signing key')
  }
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${payload}.${signature}`,
    }),
  })
  if (response.ok === false)
    throw new CalendarPublishError(`Google authorization failed (${response.status}); check the service-account key`)
  const result: unknown = await response.json()
  if (
    typeof result !== 'object' ||
    result === null ||
    !('access_token' in result) ||
    typeof result.access_token !== 'string'
  ) {
    throw new CalendarPublishError('Google authorization returned no access token')
  }
  return result.access_token
}

export const calendarClient = (calendarId: string, token: string, transport: typeof fetch = fetch) => {
  let requestCount = 0
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
  const request = async (suffix: string, init: RequestInit = {}, allowMissing = false): Promise<Response> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (++requestCount > 30) throw new CalendarPublishError('Calendar request budget exhausted (30 requests)')
      const response = await transport(`${base}${suffix}`, {
        ...init,
        signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
      })
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
        continue
      }
      if (response.ok === false && !(allowMissing === true && response.status === 404))
        throw new CalendarPublishError(
          `Calendar ${init.method ?? 'GET'} failed (${response.status}); rerun after resolving access or concurrent edits`,
        )
      return response
    }
    throw new CalendarPublishError('Calendar retry budget exhausted')
  }
  return {
    list: async (now: Date, desiredIds: string[] = []): Promise<CalendarEvent[]> => {
      const params = new URLSearchParams({
        privateExtendedProperty: `livestoreMeeting=${MEETING_OWNER}`,
        timeMin: now.toISOString(),
        maxResults: '100',
        singleEvents: 'true',
        showDeleted: 'false',
      })
      const payload: unknown = await (await request(`?${params}`)).json()
      if (
        typeof payload !== 'object' ||
        payload === null ||
        ('nextPageToken' in payload && payload.nextPageToken !== undefined && payload.nextPageToken !== '')
      ) {
        throw new CalendarPublishError('Unexpected calendar response or more than 100 managed future events')
      }
      const items = 'items' in payload ? payload.items : []
      if (Array.isArray(items) === false) throw new CalendarPublishError('Invalid calendar events response')
      const events = items.map(decodeCalendarEvent)
      for (const id of new Set(desiredIds)) {
        if (/^[a-v0-9]+$/.test(id) === false) throw new CalendarPublishError('Invalid desired calendar identity')
        if (events.some((event) => event.id === id) === true) continue
        const response = await request(`/${id}`, {}, true)
        if (response.status !== 404) {
          const event = decodeCalendarEvent(await response.json())
          if (event.id !== id) throw new CalendarPublishError('Google returned a different event identity')
          events.push(event)
        }
      }
      return events
    },
    apply: async (actions: CalendarAction[]): Promise<void> => {
      for (const action of actions) {
        if (action.kind === 'create') {
          await request('?sendUpdates=none', { method: 'POST', body: JSON.stringify(action.event) })
        } else if (action.kind === 'update') {
          await request(`/${action.event.id}?sendUpdates=none`, {
            method: 'PATCH',
            headers: { 'If-Match': action.etag },
            body: JSON.stringify(action.event),
          })
        } else {
          await request(`/${action.id}?sendUpdates=none`, { method: 'DELETE', headers: { 'If-Match': action.etag } })
        }
      }
    },
  }
}

const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url')

const requireOwned = (event: CalendarEvent): void => {
  if (event.extendedProperties?.private?.livestoreMeeting !== MEETING_OWNER) {
    throw new CalendarPublishError(`Refusing to change unowned event ${event.id}`)
  }
}

const requireEtag = (event: CalendarEvent): string => {
  if (event.etag === undefined) throw new CalendarPublishError(`Missing concurrency token for ${event.id}`)
  return event.etag
}

const sameEvent = (first: CalendarEvent, second: CalendarEvent): boolean =>
  (first.status ?? 'confirmed') === (second.status ?? 'confirmed') &&
  first.summary === second.summary &&
  first.description === second.description &&
  first.location === second.location &&
  Date.parse(first.start?.dateTime ?? '') === Date.parse(second.start?.dateTime ?? '') &&
  Date.parse(first.end?.dateTime ?? '') === Date.parse(second.end?.dateTime ?? '') &&
  first.start?.timeZone === second.start?.timeZone &&
  first.end?.timeZone === second.end?.timeZone

const decodeCalendarEvent = (value: unknown): CalendarEvent => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    /^[a-v0-9]+$/.test(value.id) === false
  )
    throw new CalendarPublishError('Invalid calendar event identity')
  const event = value as CalendarEvent
  for (const field of [event.etag, event.status, event.summary, event.description, event.location]) {
    if (field !== undefined && typeof field !== 'string') throw new CalendarPublishError('Invalid calendar event field')
  }
  requireOwned(event)
  return event
}
