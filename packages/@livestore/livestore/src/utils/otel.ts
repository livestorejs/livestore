import type * as otel from '@opentelemetry/api'

export const getDurationMsFromSpan = (span: otel.Span): number => {
  const durationHr: [seconds: number, nanos: number] = (span as any)._duration
  return durationHr[0] * 1000 + durationHr[1] / 1_000_000
}

export const getStartTimeHighResFromSpan = (span: otel.Span): DOMHighResTimeStamp =>
  (span as any)._performanceStartTime as DOMHighResTimeStamp
