import type React from 'react'

/**
 * Visualizes LiveStore events as a title with event boxes.
 * Used for documentation to illustrate event flow.
 */

interface EventsVisualizerProps {
  /** Raw event text with title and event lines */
  title: string
  events: string[]
}

interface EventProps {
  event: string
}

const Event: React.FC<EventProps> = ({ event }) => {
  return (
    <div className="min-w-8 h-8 flex items-center border-2 rounded border-sl-color-gray-5 justify-center text-xs">
      {event}
    </div>
  )
}

export const EventsVisualizer: React.FC<EventsVisualizerProps> = ({ title, events }) => {
  if (events.length === 0) {
    return null
  }

  return (
    <div className="not-content">
      {title && <div className="font-semibold text-sm pb-2">{title}</div>}
      <div className="flex gap-2 flex-wrap items-center">
        {events.map((event) => (
          <Event key={event} event={event} />
        ))}
      </div>
    </div>
  )
}
