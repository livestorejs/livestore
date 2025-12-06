import * as C from '@effect/experimental/DevTools/Client'
import type * as Domain from '@effect/experimental/DevTools/Domain'
import { Duration, Schedule } from 'effect'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import * as Graph from 'effect/Graph'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'

interface SpanNodeInfo {
  readonly span: Domain.ParentSpan
  readonly events: readonly Domain.SpanEvent[]
}

export type SpanNodeGraph = Graph.Graph<SpanNodeInfo, any>

class DebugInfo extends Effect.Service<DebugInfo>()('@mattiamanzati/debug/DebugInfo', {
  effect: Effect.sync(() => ({
    mutableGraph: Graph.beginMutation(Graph.directed<SpanNodeInfo, any>()),
    nodeIdBySpanId: new Map<string, number>(),
  })),
}) {}

const layerClientInMemoryGraph = Layer.effect(
  C.Client,
  Effect.gen(function* () {
    const { mutableGraph, nodeIdBySpanId } = yield* DebugInfo

    function ensureNode(traceId: string, spanId: string) {
      const existingNodeId = nodeIdBySpanId.get(spanId)
      if (existingNodeId !== undefined) return existingNodeId
      const nodeId = Graph.addNode(mutableGraph, {
        span: { _tag: 'ExternalSpan', spanId, traceId, sampled: false },
        events: [],
      })
      nodeIdBySpanId.set(spanId, nodeId)
      return nodeId
    }

    function upgradeInfo(prev: Domain.ParentSpan, next: Domain.ParentSpan): [Domain.ParentSpan, boolean] {
      if (prev._tag === 'ExternalSpan' && next._tag === 'Span') return [next, true]
      if (prev._tag === 'Span' && next._tag === 'ExternalSpan') return [prev, false]
      if (prev._tag === 'Span' && prev.status._tag === 'Ended') return [prev, false]
      return [next, false]
    }

    function addNode(span: Domain.ParentSpan) {
      const nodeId = ensureNode(span.traceId, span.spanId)
      Graph.updateNode(mutableGraph, nodeId, (previousInfo) => {
        const [latestInfo, upgraded] = upgradeInfo(previousInfo.span, span)
        if (upgraded && latestInfo._tag === 'Span' && Option.isSome(latestInfo.parent)) {
          const parentNodeId = addNode(latestInfo.parent.value)
          Graph.addEdge(mutableGraph, parentNodeId, nodeId, undefined)
        }
        return { ...previousInfo, span: latestInfo }
      })
      return nodeId
    }

    function addEvent(event: Domain.SpanEvent) {
      const nodeId = ensureNode(event.traceId, event.spanId)
      Graph.updateNode(mutableGraph, nodeId, (previousInfo) => ({
        ...previousInfo,
        events: [...previousInfo.events, event],
      }))
    }

    return C.Client.of({
      unsafeAddSpan: (span) => {
        switch (span._tag) {
          case 'SpanEvent':
            return addEvent(span)
          case 'Span':
            return addNode(span)
        }
      },
    })
  }),
)

export const layerDebug = pipe(
  C.makeTracer,
  Effect.map(Layer.setTracer),
  Layer.unwrapEffect,
  Layer.provide(layerClientInMemoryGraph),
  Layer.provideMerge(DebugInfo.Default),
)

function formatDuration(startTime: bigint, endTime: bigint | undefined): string {
  if (endTime === undefined) return 'running'
  const durationMs = Number(endTime - startTime) / 1000000 // Convert nanoseconds to milliseconds
  if (durationMs < 1000) return `${durationMs.toFixed(0)}ms`
  if (durationMs < 60000) return `${(durationMs / 1000).toFixed(2)}s`
  return `${(durationMs / 60000).toFixed(2)}m`
}

function getSpanName(span: Domain.ParentSpan): string {
  if (span._tag === 'ExternalSpan') return `[external] ${span.spanId}`
  return span.name
}

function getSpanStatus(span: Domain.ParentSpan): string {
  if (span._tag === 'ExternalSpan') return '?'
  if (span.status._tag === 'Ended') return '✓'
  return '●'
}

function getSpanDuration(span: Domain.ParentSpan): string {
  if (span._tag === 'ExternalSpan') return ''
  const endTime = span.status._tag === 'Ended' ? span.status.endTime : undefined
  return formatDuration(span.status.startTime, endTime)
}

/**
 * Filters a graph by keeping only nodes that match the predicate or have descendants that match.
 * This ensures parent nodes are included even if they don't match, as long as they have matching descendants.
 *
 * @param graph - The graph to filter
 * @param predicate - A function that tests whether a node should be included
 * @returns A new filtered graph containing only matching nodes and their ancestors
 */
function filterGraphWithAncestors<N, E>(
  graph: Graph.Graph<N, E>,
  predicate: (nodeData: N, nodeId: number) => boolean,
): Graph.Graph<N, E> {
  // Find all root nodes (nodes with no incoming edges)
  const rootNodes = Array.from(Graph.indices(Graph.externals(graph, { direction: 'incoming' })))

  const shouldInclude = new Map<number, boolean>()

  // Use postorder DFS to evaluate children before parents
  for (const rootId of rootNodes) {
    for (const nodeId of Graph.indices(Graph.dfsPostOrder(graph, { startNodes: [rootId], direction: 'outgoing' }))) {
      const node = Graph.getNode(graph, nodeId)
      if (Option.isNone(node)) continue

      const matchesPredicate = predicate(node.value, nodeId)

      // Check if any children should be included
      const children = Graph.neighborsDirected(graph, nodeId, 'outgoing')
      const hasMatchingChildren = children.some((childId) => shouldInclude.get(childId) === true)

      const include = matchesPredicate || hasMatchingChildren
      shouldInclude.set(nodeId, include)
    }
  }

  // Create a filtered copy of the graph
  return Graph.mutate(graph, (mutable) => {
    for (const [nodeId] of mutable.nodes) {
      if (shouldInclude.get(nodeId) === true) continue
      Graph.removeNode(mutable, nodeId)
    }
  })
}

function renderNode(graph: SpanNodeGraph, nodeId: number, prefix = '', isLast = true): string[] {
  const node = Graph.getNode(graph, nodeId)
  if (Option.isNone(node)) return []

  const info = node.value
  const status = getSpanStatus(info.span)
  const name = getSpanName(info.span)
  const duration = getSpanDuration(info.span)
  const durationStr = duration ? ` ${duration}` : ''

  const connector = isLast ? '└─ ' : '├─ '
  const lines: string[] = [`${prefix}${connector}${status} ${name}${durationStr}`]

  // Get children
  const children = Graph.neighborsDirected(graph, nodeId, 'outgoing')
  const childCount = children.length

  children.forEach((childId: number, index: number) => {
    const isLastChild = index === childCount - 1
    const childPrefix = prefix + (isLast ? '  ' : '│ ')
    const childLines = renderNode(graph, childId, childPrefix, isLastChild)
    lines.push(...childLines)
  })

  return lines
}

interface ChromeTraceEvent {
  name: string
  cat: string
  ph: string // Phase: 'B' for begin, 'E' for end
  ts: number // Timestamp in microseconds
  pid: number // Process ID
  tid: number // Thread ID
  args?: Record<string, unknown>
}

/**
 * Converts a span node to Chrome Trace Events (Begin and End)
 */
function spanToTraceEvents(span: Domain.ParentSpan, _nodeId: number, processId = 1): ChromeTraceEvent[] {
  const events: ChromeTraceEvent[] = []

  if (span._tag === 'ExternalSpan') {
    // External spans don't have timing info, skip them
    return events
  }

  const name = span.name
  const threadId = 1 // Could use spanId hash or other identifier

  // Begin event
  const startTimeUs = Number(span.status.startTime) / 1000 // Convert nanoseconds to microseconds
  events.push({
    name,
    cat: 'span',
    ph: 'B',
    ts: startTimeUs,
    pid: processId,
    tid: threadId,
    args: {
      spanId: span.spanId,
      traceId: span.traceId,
      attributes: Object.fromEntries(span.attributes),
    },
  })

  // End event (only if span has ended)
  if (span.status._tag === 'Ended') {
    const endTimeUs = Number(span.status.endTime) / 1000 // Convert nanoseconds to microseconds
    events.push({
      name,
      cat: 'span',
      ph: 'E',
      ts: endTimeUs,
      pid: processId,
      tid: threadId,
    })
  }

  return events
}

/**
 * Traverses the graph and collects all trace events
 */
function collectTraceEvents(graph: SpanNodeGraph, rootNodes: number[]): ChromeTraceEvent[] {
  const events: ChromeTraceEvent[] = []

  // Use DFS to traverse all nodes
  for (const rootId of rootNodes) {
    for (const nodeId of Graph.indices(Graph.dfs(graph, { startNodes: [rootId], direction: 'outgoing' }))) {
      const node = Graph.getNode(graph, nodeId)
      if (Option.isNone(node)) continue

      const nodeEvents = spanToTraceEvents(node.value.span, nodeId)
      events.push(...nodeEvents)
    }
  }

  // Sort events by timestamp
  events.sort((a, b) => a.ts - b.ts)

  return events
}

export interface LogTreeOptions {
  readonly regex?: RegExp
  readonly title?: string
}

export const logTree = (options: LogTreeOptions = {}) =>
  Effect.gen(function* () {
    const maybeInfo = yield* Effect.serviceOption(DebugInfo)
    if (Option.isNone(maybeInfo))
      return yield* Console.log(
        '(no debug info provided! To show the tree, provide the layerDebug layer in the root of your program)',
      )

    const { mutableGraph } = maybeInfo.value
    const graph = Graph.endMutation(mutableGraph)

    // Find root nodes (nodes with no incoming edges) using externals
    const rootNodes = Array.from(Graph.indices(Graph.externals(graph, { direction: 'incoming' })))

    if (rootNodes.length === 0) {
      return yield* Console.log('(empty trace)')
    }

    // Apply filter to create a filtered copy of the graph
    const filteredGraph = options.regex
      ? filterGraphWithAncestors(graph, (nodeData, _nodeId) => {
          const name = getSpanName(nodeData.span)
          return options.regex!.test(name)
        })
      : graph

    // Find root nodes in the filtered graph
    const filteredRootNodes = Array.from(Graph.indices(Graph.externals(filteredGraph, { direction: 'incoming' })))

    if (filteredRootNodes.length === 0) {
      return yield* Console.log(options.title ? `${options.title}\n(no matches)` : '(no matches)')
    }

    const lines: string[] = []

    // Add title if provided
    if (options.title) {
      lines.push(options.title)
    }

    // Render root nodes using the same logic as regular children
    const rootCount = filteredRootNodes.length
    filteredRootNodes.forEach((rootId: number, index: number) => {
      const isLastRoot = index === rootCount - 1
      const rootLines = renderNode(filteredGraph, rootId, '', isLastRoot)
      lines.push(...rootLines)
    })

    return yield* Console.log(lines.join('\n'))
  })

export interface LogPerformanceTraceOptions {
  readonly regex?: RegExp
}

/**
 * Logs the span tree in Chrome Performance Trace Event Format.
 * The output can be loaded in Chrome DevTools Performance tab or chrome://tracing
 *
 * @see https://docs.google.com/document/d/1CvAClvFfyA5R-PhYUmn5OOQtYMH4h6I0nSsKchNAySU/preview
 */
export const logPerformanceTrace = (options: LogPerformanceTraceOptions = {}) =>
  Effect.gen(function* () {
    const maybeInfo = yield* Effect.serviceOption(DebugInfo)
    if (Option.isNone(maybeInfo)) {
      return yield* Console.log(
        '(no debug info provided! To show the trace, provide the layerDebug layer in the root of your program)',
      )
    }

    const { mutableGraph } = maybeInfo.value
    const graph = Graph.endMutation(mutableGraph)

    // Find root nodes (nodes with no incoming edges) using externals
    const rootNodes = Array.from(Graph.indices(Graph.externals(graph, { direction: 'incoming' })))

    if (rootNodes.length === 0) {
      return yield* Console.log('[]')
    }

    // Apply filter if provided
    const filteredGraph = options.regex
      ? filterGraphWithAncestors(graph, (nodeData, _nodeId) => {
          const name = getSpanName(nodeData.span)
          return options.regex!.test(name)
        })
      : graph

    // Find root nodes in the filtered graph
    const filteredRootNodes = Array.from(Graph.indices(Graph.externals(filteredGraph, { direction: 'incoming' })))

    // Collect all trace events
    const events = collectTraceEvents(filteredGraph, filteredRootNodes)

    // Output as compact JSON array
    const json = JSON.stringify(events)
    return yield* Console.log(json)
  })

export const logScopeState = ({ label }: { label: string }) =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope
    yield* Effect.log(`scope.state[${label}]`, (scope as any).state._tag).pipe(
      Effect.repeat({ schedule: Schedule.fixed(Duration.millis(100)) }),
      Effect.forkScoped,
    )
  })
