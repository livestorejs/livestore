import { identity } from '@livestore/utils/effect'
import type { Attributes } from '@opentelemetry/api'
import type { InMemorySpanExporter, ReadableSpan } from '@opentelemetry/sdk-trace-base'

type SimplifiedNestedSpan = { _name: string; attributes: any; children: SimplifiedNestedSpan[] }

export const getSimplifiedRootSpan = (
  exporter: InMemorySpanExporter,
  mapAttributes?: (attributes: Attributes) => Attributes,
) => {
  const spans = exporter.getFinishedSpans()
  const spansMap = new Map<string, NestedSpan>(spans.map((span) => [span.spanContext().spanId, { span, children: [] }]))

  const mapAttributesfn = mapAttributes ?? identity

  spansMap.forEach((nestedSpan) => {
    const parentSpan = nestedSpan.span.parentSpanId ? spansMap.get(nestedSpan.span.parentSpanId) : undefined
    if (parentSpan) {
      parentSpan.children.push(nestedSpan)
    }
  })

  type NestedSpan = { span: ReadableSpan; children: NestedSpan[] }
  const rootSpan = spansMap.get(spans.find((_) => _.name === 'test')!.spanContext().spanId)!

  const simplifySpan = (span: NestedSpan): SimplifiedNestedSpan =>
    omitEmpty({
      _name: span.span.name,
      attributes: mapAttributesfn(span.span.attributes),
      children: span.children
        .filter((_) => _.span.name !== 'createStore')
        // .sort((a, b) => compareHrTime(a.span.startTime, b.span.startTime))
        .map(simplifySpan),
    })

  // console.dir(
  //   spans.map((_) => [_.spanContext().spanId, _.name, _.attributes, _.parentSpanId]),
  //   { depth: 10 },
  // )

  return simplifySpan(rootSpan)
}

// const compareHrTime = (a: [number, number], b: [number, number]) => {
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
