import { identity } from '@livestore/utils/effect'
import type { Attributes } from '@opentelemetry/api'
import type { InMemorySpanExporter, ReadableSpan } from '@opentelemetry/sdk-trace-base'

type SimplifiedNestedSpan = { _name: string; attributes: any; children: SimplifiedNestedSpan[] }

type NestedSpan = { span: ReadableSpan; children: NestedSpan[] }

const buildSimplifiedRootSpans = (
  exporter: InMemorySpanExporter,
  rootSpanName: string,
  mapAttributes?: (attributes: Attributes) => Attributes,
): SimplifiedNestedSpan[] => {
  const spans = exporter.getFinishedSpans()
  const spansMap = new Map<string, NestedSpan>(spans.map((span) => [span.spanContext().spanId, { span, children: [] }]))

  const mapAttributesfn = mapAttributes ?? identity

  spansMap.forEach((nestedSpan) => {
    const parentId = nestedSpan.span.parentSpanContext?.spanId
    const parentSpan = parentId ? spansMap.get(parentId) : undefined
    if (parentSpan) {
      parentSpan.children.push(nestedSpan)
    }
  })

  const rootSpanDataList = spans.filter((_) => _.name === rootSpanName)
  if (rootSpanDataList.length === 0) {
    throw new Error(
      `Could not find any root spans named '${rootSpanName}'. Available spans: ${spans.map((s) => s.name).join(', ')}`,
    )
  }

  const simplifySpanRec = (span: NestedSpan): SimplifiedNestedSpan =>
    omitEmpty({
      _name: span.span.name,
      attributes: mapAttributesfn(span.span.attributes),
      children: span.children
        .filter((_) => _.span.name !== 'createStore:makeAdapter')
        // .sort((a, b) => compareHrTime(a.span.startTime, b.span.startTime))
        .map(simplifySpanRec),
    })

  return rootSpanDataList.map((rootSpanData) => {
    const rootSpan = spansMap.get(rootSpanData.spanContext().spanId)!
    return simplifySpanRec(rootSpan)
  })
}

export const getSimplifiedRootSpan = (
  exporter: InMemorySpanExporter,
  rootSpanName: string,
  mapAttributes?: (attributes: Attributes) => Attributes,
): SimplifiedNestedSpan => {
  const results = buildSimplifiedRootSpans(exporter, rootSpanName, mapAttributes)
  const firstResult = results[0]
  if (!firstResult) throw new Error(`Could not find the root span named '${rootSpanName}'.`)
  return firstResult
}

export const getAllSimplifiedRootSpans = (
  exporter: InMemorySpanExporter,
  rootSpanName: string,
  mapAttributes?: (attributes: Attributes) => Attributes,
): SimplifiedNestedSpan[] => {
  return buildSimplifiedRootSpans(exporter, rootSpanName, mapAttributes)
}

// const compareHrTime = (a: [number, numndber], b: [number, number]) => {
//   if (a[0] !== b[0]) return a[0] - b[0]
//   return a[1] - b[1]
// }

const omitEmpty = (obj: any) => {
  const result: any = {}
  for (const key in obj) {
    if (
      obj[key] !== undefined &&
      !(Array.isArray(obj[key]) && obj[key].length === 0) &&
      Object.keys(obj[key]).length > 0
    ) {
      result[key] = obj[key]
    }
  }
  return result
}

export const toTraceFile = (spans: ReadableSpan[]) => {
  const hrTimeToBigInt = (hrTime: [number, number]) => (BigInt(hrTime[0]) * BigInt(1e9) + BigInt(hrTime[1])).toString()
  return {
    batches: [
      {
        resource: {
          attributes: [
            {
              key: 'service.name',
              value: {
                stringValue: 'test',
              },
            },
          ],
          droppedAttributesCount: 0,
        },
        instrumentationLibrarySpans: [
          {
            spans: spans.map((span) => ({
              traceId: span.spanContext().traceId,
              spanId: span.spanContext().spanId,
              ...(span.parentSpanContext?.spanId ? { parentSpanId: span.parentSpanContext.spanId } : {}),
              // traceState: span.spanContext().traceState ?? '',
              name: span.name,
              kind: 'SPAN_KIND_INTERNAL',
              startTimeUnixNano: hrTimeToBigInt(span.startTime),
              endTimeUnixNano: hrTimeToBigInt(span.endTime),
              attributes: Object.entries(span.attributes).map(([key, value]) => ({
                key,
                value:
                  typeof value === 'string'
                    ? { stringValue: value }
                    : typeof value === 'number'
                      ? Number.isInteger(value)
                        ? { intValue: value }
                        : { doubleValue: value }
                      : typeof value === 'boolean'
                        ? { boolValue: value }
                        : { stringValue: JSON.stringify(value) },
              })),
              droppedAttributesCount: span.droppedAttributesCount ?? 0,
              droppedEventsCount: span.droppedEventsCount ?? 0,
              droppedLinksCount: span.droppedLinksCount ?? 0,
              status: {
                code: span.status.code,
                message: span.status.message ?? '',
              },
            })),
            instrumentationLibrary: {
              name: 'livestore',
              version: '',
            },
          },
        ],
      },
    ],
  }
}
