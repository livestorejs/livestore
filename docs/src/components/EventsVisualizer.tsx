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
  fullNotation: string
  segmentNotation: string
  clientLabel?: string
  globalSequenceNumber: number
  clientSequenceNumber?: number
  rebaseGeneration?: number
  isUnconfirmed: boolean
  context?: string
  contextSegments: string[]
  originChain: ParsedEvent[]
  parseError?: string
}

interface EventProps {
  event: ParsedEvent
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
  return (
    <div className="min-w-8 h-8 flex items-center border-2 rounded border-sl-color-gray-5 justify-center text-xs">
      {event.fullNotation}
    </div>
  )
}

export const EventsVisualizer: FC<EventsVisualizerProps> = ({ title, events }) => {
  if (events.length === 0) {
    return null
  }

  return (
    <div className="not-content">
      {title && <div className="font-semibold text-sm pb-2">{title}</div>}
      <div className="flex gap-2 flex-wrap items-center">
        {events.map((event, index) => {
          const parsedEvent = parseEventNotation(event)
          return <Event key={`event-${index}-${event}`} event={parsedEvent} />
        })}
      </div>
    </div>
  )
}
