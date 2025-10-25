import type { FC } from 'react'

/**
 * Visualizes LiveStore events as a title with event boxes.
 * Used for documentation to illustrate event flow.
 */

interface EventsVisualizerProps {
  title: string
  events: string[]
}

interface ParsedEvent {
  /** Entire notation string, for example `B:e5'/e3'`. */
  fullNotation: string
  /** Segment being parsed, for example `B:e5'` before origin expansion. */
  segmentNotation: string
  /** Client prefix such as `A` in `A:e3'`. */
  clientLabel?: string
  /** Global event number, for example `5` in `e5.1`. */
  globalSequenceNumber: number
  /** Client-local counter, for example `1` in `e5.1`. */
  clientSequenceNumber?: number
  /** Rebase generation indicator, for example `2` in `e4r2`. */
  rebaseGeneration?: number
  /** Whether the event is unconfirmed, as shown by the trailing `'` in `e3'`. */
  isUnconfirmed: boolean
  /** Context hint extracted from braces, for example `userCreated` in `e2{userCreated}`. */
  context?: string
  /** Context path split into segments, for example `['user', '123']` for `{user.123}`. */
  contextSegments: string[]
  /** Parsed origin segments, for example the `e3'` part of `B:e5'/e3'`. */
  originChain: ParsedEvent[]
  /** Error message when parsing fails, for example when the sequence number is missing. */
  parseError?: string
}

interface EventProps {
  event: ParsedEvent
}

const baseEventClassList = [
  'min-w-8',
  'h-8',
  'flex',
  'items-center',
  'border-2',
  'rounded',
  'border-black',
  'dark:border-white',
  'justify-center',
  'text-xs',
  'px-2',
  'text-slate-900',
  'cursor-default',
  'bg-gray-600',
  'text-white',
]

const clientLabelClassMap: Record<string, string[]> = {
  A: ['bg-orange-600', 'text-white'],
  B: ['bg-green-500', 'text-white'],
  C: ['bg-amber-500', 'text-white'],
}

const getClientLabelClasses = (label: string | undefined): string[] => {
  if (!label) {
    return []
  }

  const normalizedLabel = label.trim()
  if (normalizedLabel.length === 0) {
    return []
  }

  const mappedClasses = clientLabelClassMap[normalizedLabel]
  if (mappedClasses) {
    return mappedClasses
  }

  return ['bg-slate-500', 'text-white']
}

const buildEventClassNames = (event: ParsedEvent): string => {
  const classes = [...baseEventClassList]

  if (event.isUnconfirmed) {
    classes.push('border-dashed', 'opacity-80')
  } else {
    classes.push('border-solid')
  }

  if (event.clientLabel) {
    classes.push(...getClientLabelClasses(event.clientLabel))
  }

  if (event.parseError) {
    classes.push('bg-red-600', 'text-white')
  }

  return classes.join(' ')
}

const renderBaseNotation = (event: ParsedEvent): string => {
  if (Number.isNaN(event.globalSequenceNumber)) {
    return event.segmentNotation || event.fullNotation
  }

  let notation = `e${event.globalSequenceNumber}`

  if (typeof event.clientSequenceNumber === 'number') {
    notation += `.${event.clientSequenceNumber}`
  }

  if (typeof event.rebaseGeneration === 'number') {
    notation += `r${event.rebaseGeneration}`
  }

  if (event.isUnconfirmed) {
    notation += "'"
  }

  return notation
}

const parseEventSegment = (segment: string): ParsedEvent => {
  const trimmedSegment = segment.trim()
  let workingSegment = trimmedSegment
  let context: string | undefined
  const contextSegments: string[] = []

  const contextMatch = workingSegment.match(/\{([^}]*)\}$/)
  if (contextMatch && contextMatch[1] !== undefined) {
    const contextValue = contextMatch[1]
    context = contextValue
    if (contextValue.length > 0) {
      contextSegments.push(...contextValue.split('.'))
    }
    workingSegment = workingSegment.slice(0, workingSegment.length - contextMatch[0].length)
  }

  let isUnconfirmed = false
  if (workingSegment.endsWith("'")) {
    isUnconfirmed = true
    workingSegment = workingSegment.slice(0, -1)
  }

  let rebaseGeneration: number | undefined
  const rebaseMatch = workingSegment.match(/r(\d+)$/)
  if (rebaseMatch && rebaseMatch[1] !== undefined) {
    rebaseGeneration = Number.parseInt(rebaseMatch[1], 10)
    workingSegment = workingSegment.slice(0, workingSegment.length - rebaseMatch[0].length)
  }

  let clientLabel: string | undefined
  let eventPart = workingSegment
  const colonIndex = workingSegment.indexOf(':')
  if (colonIndex !== -1) {
    clientLabel = workingSegment.slice(0, colonIndex).trim()
    eventPart = workingSegment.slice(colonIndex + 1)
  }

  const eventMatch = eventPart.match(/^e(\d+)(?:\.(\d+))?$/)
  let parseError: string | undefined
  let globalSequenceNumber = Number.NaN
  let clientSequenceNumber: number | undefined

  if (!eventMatch || eventMatch[1] === undefined) {
    parseError = `Unable to parse event sequence from "${trimmedSegment}".`
  } else {
    const globalDigits = eventMatch[1]
    globalSequenceNumber = Number.parseInt(globalDigits, 10)
    const clientDigits = eventMatch[2]
    if (clientDigits !== undefined) {
      clientSequenceNumber = Number.parseInt(clientDigits, 10)
    }
  }

  const parsedEvent: ParsedEvent = {
    fullNotation: trimmedSegment,
    segmentNotation: trimmedSegment,
    globalSequenceNumber,
    isUnconfirmed,
    contextSegments,
    originChain: [],
  }

  if (clientLabel !== undefined) {
    parsedEvent.clientLabel = clientLabel
  }

  if (clientSequenceNumber !== undefined) {
    parsedEvent.clientSequenceNumber = clientSequenceNumber
  }

  if (rebaseGeneration !== undefined) {
    parsedEvent.rebaseGeneration = rebaseGeneration
  }

  if (context !== undefined) {
    parsedEvent.context = context
  }

  if (parseError !== undefined) {
    parsedEvent.parseError = parseError
  }

  return parsedEvent
}

const parseEventNotation = (notation: string): ParsedEvent => {
  const trimmedNotation = notation.trim()

  if (trimmedNotation.length === 0) {
    return {
      fullNotation: '',
      segmentNotation: '',
      globalSequenceNumber: Number.NaN,
      isUnconfirmed: false,
      contextSegments: [],
      originChain: [],
      parseError: 'Event notation is empty.',
    }
  }

  const segments = trimmedNotation.split('/')
  const primarySegment = segments[0]

  if (primarySegment === undefined) {
    return {
      fullNotation: trimmedNotation,
      segmentNotation: '',
      globalSequenceNumber: Number.NaN,
      isUnconfirmed: false,
      contextSegments: [],
      originChain: [],
      parseError: 'Event notation is missing the primary segment.',
    }
  }

  const primaryParsed = parseEventSegment(primarySegment)
  const originChain = segments
    .slice(1)
    .filter((segment): segment is string => segment !== undefined)
    .map((segment) => parseEventSegment(segment))

  const parsedEvent: ParsedEvent = {
    ...primaryParsed,
    fullNotation: trimmedNotation,
    originChain,
  }

  return parsedEvent
}

const Event: FC<EventProps> = ({ event }) => {
  const className = buildEventClassNames(event)
  const displayNotation = renderBaseNotation(event)

  return (
    <div className="relative group">
      <div className={className}>{displayNotation}</div>
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 -translate-y-[5px] hidden group-hover:block bg-white text-black text-xs px-2 py-1 rounded whitespace-nowrap pointer-events-none z-10">
        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
          {event.context && (
            <>
              <div className="font-semibold">Context:</div>
              <div>{event.context}</div>
            </>
          )}
          {event.clientLabel && (
            <>
              <div className="font-semibold">Client label:</div>
              <div>{event.clientLabel}</div>
            </>
          )}
          {!Number.isNaN(event.globalSequenceNumber) && (
            <>
              <div className="font-semibold">Global sequence:</div>
              <div>{event.globalSequenceNumber}</div>
            </>
          )}
          {event.clientSequenceNumber !== undefined && (
            <>
              <div className="font-semibold">Client sequence:</div>
              <div>{event.clientSequenceNumber}</div>
            </>
          )}
          <div className="font-semibold">Confirmed:</div>
          <div>{event.isUnconfirmed ? 'No' : 'Yes'}</div>
          {event.originChain.length > 0 && (
            <>
              <div className="font-semibold">Origin chain:</div>
              <div>{event.originChain.map((origin) => origin.fullNotation).join(' → ')}</div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const EventsNode: FC<EventsVisualizerProps> = ({ title, events }) => {
  if (events.length === 0) {
    return null
  }

  return (
    <div className="not-content pl-6 flex items-center">
      {title && <div className="font-semibold text-sm w-28">{title}</div>}
      <div className="flex gap-2 flex-wrap items-center">
        {events.map((event, index) => {
          const parsedEvent = parseEventNotation(event)
          return <Event key={`event-${index}-${event}`} event={parsedEvent} />
        })}
      </div>
    </div>
  )
}

interface EventsVisualizerGroupProps {
  client?: string[]
  leader?: string[]
  backend?: string[]
}

export const EventsVisualizer: FC<EventsVisualizerGroupProps> = ({ client, leader, backend }) => {
  return (
    <div className="flex flex-col gap-1 pt-6">
      {client && client.length > 0 && <EventsNode title="Client Session" events={client} />}
      {leader && leader.length > 0 && <EventsNode title="Client Leader" events={leader} />}
      {backend && backend.length > 0 && <EventsNode title="Sync Backend" events={backend} />}
    </div>
  )
}
