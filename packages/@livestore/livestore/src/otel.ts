import type * as otel from '@opentelemetry/api'

// TODO improve - see https://www.notion.so/schickling/Better-solution-for-globalThis-inProgressSpans-503cd7a5f4fc4fb8bdec2e60bde1be1f
export const TODO_REMOVE_trackLongRunningSpan = (span: otel.Span): void => {
  // @ts-expect-error TODO get rid of this coupling
  if (window.inProgressSpans !== undefined && window.inProgressSpans instanceof Set) {
    // @ts-expect-error TODO get rid of this coupling
    window.inProgressSpans.add(span)
  } else {
    debugger
  }
}

export const getDurationMsFromSpan = (span: otel.Span): number => {
  const durationHr: [seconds: number, nanos: number] = (span as any)._duration
  return durationHr[0] * 1000 + durationHr[1] / 1_000_000
}

export const getStartTimeHighResFromSpan = (span: otel.Span): DOMHighResTimeStamp =>
  (span as any)._performanceStartTime as DOMHighResTimeStamp
