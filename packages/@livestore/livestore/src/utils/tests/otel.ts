import { identity } from '@livestore/utils/effect'
import type { Attributes } from '@opentelemetry/api'
import type { InMemorySpanExporter, ReadableSpan } from '@opentelemetry/sdk-trace-base'
type SimplifiedNestedSpan = { _name: string; attributes: any; children: SimplifiedNestedSpan[] }

export const getSimplifiedRootSpan = (
  exporter: InMemorySpanExporter,
  mapAttributes?: (attributes: Attributes) => Attributes,
): SimplifiedNestedSpan => {
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

  type NestedSpan = { span: ReadableSpan; children: NestedSpan[] }
  const createStoreSpanData = spans.find((_) => _.name === 'createStore')
  if (createStoreSpanData === undefined) {
    throw new Error(
      "Could not find the root span named 'createStore'. Available spans: " + spans.map((s) => s.name).join(', '),
    )
  }
  const rootSpan = spansMap.get(createStoreSpanData.spanContext().spanId)!

  const simplifySpanRec = (span: NestedSpan): SimplifiedNestedSpan =>
    omitEmpty({
      _name: span.span.name,
      attributes: mapAttributesfn(span.span.attributes),
      children: span.children
        .filter((_) => _.span.name !== 'createStore:makeAdapter')
        // .sort((a, b) => compareHrTime(a.span.startTime, b.span.startTime))
        .map(simplifySpanRec),
    })

  // console.log('rootSpan', rootSpan.span)

  // console.dir(
  //   spans.map((_) => [_.spanContext().spanId, _.name, _.attributes, _.parentSpanId]),
  //   { depth: 10 },
  // )

  const simplifiedRootSpan = simplifySpanRec(rootSpan)

  // console.log('simplifiedRootSpan', simplifiedRootSpan)

  // writeFileSync('tmp/trace.json', JSON.stringify(toTraceFile(spans), null, 2))

  return simplifiedRootSpan
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
