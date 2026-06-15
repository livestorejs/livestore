import * as Cause from 'effect/Cause'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import type * as Exit from 'effect/Exit'
import type * as Fiber from 'effect/Fiber'
import * as Graph from 'effect/Graph'
import * as Option from 'effect/Option'
import * as Scope from 'effect/Scope'
import * as Tracer from 'effect/Tracer'

/**
 * How to use:
 * 1. Call `Debug.attachSlowDebugInstrumentation` in the root/main file of your program to ensure it is loaded as soon as possible.
 * 2. Call `Debug.logDebug` to log the current state of the effect system.
 */

interface SpanEvent {
  readonly name: string
  readonly startTime: bigint
  readonly attributes?: Record<string, unknown>
}

interface GraphNodeInfo {
  readonly span: Tracer.AnySpan
  readonly exitTag: 'Success' | 'Failure' | 'Interrupted' | undefined
  readonly events: Array<SpanEvent>
}

export type MutableSpanGraph = Graph.MutableGraph<GraphNodeInfo, void>
export type MutableSpanGraphInfo = {
  readonly graph: MutableSpanGraph
  readonly nodeIdBySpanId: Map<string, number>
}

const graphByTraceId = new Map<string, MutableSpanGraphInfo>()

const ensureSpan = (traceId: string, spanId: string): [MutableSpanGraph, number] => {
  let info = graphByTraceId.get(traceId)
  if (info === undefined) {
    info = {
      graph: Graph.beginMutation(Graph.directed<GraphNodeInfo, void>()),
      nodeIdBySpanId: new Map<string, number>(),
    }
    graphByTraceId.set(traceId, info)
  }
  let nodeId = info.nodeIdBySpanId.get(spanId)
  if (nodeId === undefined) {
    nodeId = Graph.addNode(info.graph, {
      span: { _tag: 'ExternalSpan', spanId, traceId, sampled: false, annotations: Context.empty() },
      events: [],
      exitTag: undefined,
    })
    info.nodeIdBySpanId.set(spanId, nodeId)
  }
  return [info.graph, nodeId]
}

const sortSpan = (
  prev: Tracer.AnySpan,
  next: Tracer.AnySpan,
): [info: Tracer.AnySpan, isUpgrade: boolean, timingUpdated: boolean] => {
  if (prev._tag === 'ExternalSpan' && next._tag === 'Span') return [next, true, true]
  if (prev._tag === 'Span' && next._tag === 'Span' && next.status._tag === 'Ended') return [next, false, true]
  return [prev, false, false]
}

const addNode = (span: Tracer.AnySpan) => {
  const [mutableGraph, nodeId] = ensureSpan(span.traceId, span.spanId)
  Graph.updateNode(mutableGraph, nodeId, (previousInfo) => {
    const [latestInfo, upgraded] = sortSpan(previousInfo.span, span)
    if (upgraded === true && latestInfo._tag === 'Span' && Option.isSome(latestInfo.parent) === true) {
      const parentNodeId = addNode(latestInfo.parent.value)
      Graph.addEdge(mutableGraph, parentNodeId, nodeId, undefined)
    }
    return { ...previousInfo, span: latestInfo }
  })
  return nodeId
}

const addEvent = (traceId: string, spanId: string, event: SpanEvent) => {
  const [mutableGraph, nodeId] = ensureSpan(traceId, spanId)
  Graph.updateNode(mutableGraph, nodeId, (previousInfo) => {
    return { ...previousInfo, events: [...previousInfo.events, event] }
  })
  return nodeId
}
const addNodeExit = (traceId: string, spanId: string, exit: Exit.Exit<any, any>) => {
  const [mutableGraph, nodeId] = ensureSpan(traceId, spanId)
  Graph.updateNode(mutableGraph, nodeId, (previousInfo) => {
    const isInterruptedOnly = exit._tag === 'Failure' && Cause.hasInterruptsOnly(exit.cause)
    return {
      ...previousInfo,
      exitTag: isInterruptedOnly === true ? ('Interrupted' as const) : exit._tag,
    }
  })
  return nodeId
}

const createPropertyInterceptor = <T extends object, K extends keyof T>(
  obj: T,
  property: K,
  interceptor: (value: T[K]) => void,
): void => {
  const descriptor = Object.getOwnPropertyDescriptor(obj, property)

  const previousSetter = descriptor?.set

  let currentValue: T[K]
  const previousGetter = descriptor?.get

  if (previousGetter == null) {
    currentValue = obj[property]
  }

  Object.defineProperty(obj, property, {
    get(): T[K] {
      if (previousGetter !== undefined) {
        return previousGetter.call(obj)
      }
      return currentValue
    },
    set(value: T[K]) {
      if (previousSetter !== undefined) {
        previousSetter.call(obj, value)
      } else {
        currentValue = value
      }
      interceptor(value)
    },
    enumerable: descriptor?.enumerable ?? true,
    configurable: descriptor?.configurable ?? true,
  })
}

type EffectDevtoolsHookEvent =
  | {
      _tag: 'FiberAllocated'
      fiber: Fiber.Fiber<any, any>
    }
  | {
      _tag: 'ScopeAllocated'
      scope: Scope.Scope
    }

type GlobalWithFiberCurrent = {
  '~effect/Fiber/currentFiber': Fiber.Fiber<any, any> | undefined
  'effect/DevtoolsHook'?: {
    onEvent: (event: EffectDevtoolsHookEvent) => void
  }
}

const patchedTracer = new WeakSet<Tracer.Tracer>()
const ensureTracerPatched = (currentTracer: Tracer.Tracer) => {
  if (patchedTracer.has(currentTracer) === true) {
    return
  }
  patchedTracer.add(currentTracer)

  const oldSpanConstructor = currentTracer.span
  currentTracer.span = function (...args) {
    const span = oldSpanConstructor.apply(this, args)
    addNode(span)

    const oldSpanEnd = span.end
    span.end = function (endTime, exit, ...args) {
      oldSpanEnd.apply(this, [endTime, exit, ...args])
      addNodeExit(this.traceId, this.spanId, exit)
    }

    const oldSpanEvent = span.event
    span.event = function (name, startTime, attributes, ...args) {
      oldSpanEvent.apply(this, [name, startTime, attributes, ...args])
      addEvent(this.traceId, this.spanId, { name, startTime, attributes: attributes ?? {} })
    }

    return span
  }

  const oldContext = currentTracer.context
  Object.defineProperty(currentTracer, 'context', {
    configurable: true,
    value: function <X>(this: Tracer.Tracer, f: Tracer.EffectPrimitive<X>, fiber: Fiber.Fiber<any, any>): X {
      const context =
        oldContext === undefined
          ? (
              f as Tracer.EffectPrimitive<X> & {
                readonly '~effect/Effect/evaluate': (fiber: Fiber.Fiber<any, any>) => X
              }
            )['~effect/Effect/evaluate'](fiber)
          : (oldContext.call(this, f, fiber) as X)
      ensureFiberPatched(fiber)
      return context
    },
  })
}

const knownScopes = new Map<
  Scope.Scope,
  { id: number; allocationFiber: Fiber.Fiber<any, any> | undefined; allocationSpan: Tracer.AnySpan | undefined }
>()
let lastScopeId = 0
const ensureScopePatched = (scope: Scope.Scope, allocationFiber: Fiber.Fiber<any, any> | undefined) => {
  if (scope.state._tag === 'Closed' || scope.state._tag === 'Empty') return
  if (knownScopes.has(scope) === true) return
  const id = lastScopeId++
  if (patchScopeClose === true) {
    // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- patching Scope.close; close is an internal implementation detail
    const oldClose = (scope as any).close
    // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- patching Scope.close; close is an internal implementation detail
    ;(scope as any).close = function (...args: any[]) {
      return oldClose.apply(this, args).pipe(
        Effect.withSpan(`scope.${id}.closeRunFinalizers`),
        Effect.ensuring(
          Effect.sync(() => {
            knownScopes.delete(scope)
          }),
        ),
      )
    }
  } else {
    cleanupScopes()
  }
  const allocationSpan = allocationFiber?.currentSpan
  knownScopes.set(scope, { id, allocationFiber, allocationSpan })
}
const cleanupScopes = () => {
  for (const [scope] of knownScopes) {
    if (scope.state._tag === 'Closed' || scope.state._tag === 'Empty') knownScopes.delete(scope)
  }
}

const knownFibers = new Set<Fiber.Fiber<any, any>>()
const ensureFiberPatched = (fiber: Fiber.Fiber<any, any>) => {
  // patch tracer
  const tracer = fiber.getRef(Tracer.Tracer)
  ensureTracerPatched(tracer)
  ;(fiber as Fiber.Fiber<any, any> & { currentTracerContext?: Tracer.Tracer['context'] }).currentTracerContext =
    tracer.context
  // patch scope
  const currentScope = Context.getOrElse(fiber.context, Scope.Scope, () => undefined)
  if (currentScope !== undefined) ensureScopePatched(currentScope, undefined)
  // patch fiber
  if (knownFibers.has(fiber) === true) return
  knownFibers.add(fiber)
  fiber.addObserver((exit) => {
    knownFibers.delete(fiber)
    onFiberCompleted?.(fiber, exit)
  })
}

let patchScopeClose = false
let onFiberResumed: undefined | ((fiber: Fiber.Fiber<any, any>) => void)
let onFiberSuspended: undefined | ((fiber: Fiber.Fiber<any, any>) => void)
let onFiberCompleted: undefined | ((fiber: Fiber.Fiber<any, any>, exit: Exit.Exit<any, any>) => void)
export const attachSlowDebugInstrumentation = (options: {
  /** If set to true, the scope prototype will be patched to attach a span to visualize pending scope closing */
  readonly patchScopeClose?: boolean
  /** An optional callback that will be called when any fiber resumes performing a run loop */
  readonly onFiberResumed?: (fiber: Fiber.Fiber<any, any>) => void
  /** An optional callback that will be called when any fiber stops performing a run loop */
  readonly onFiberSuspended?: (fiber: Fiber.Fiber<any, any>) => void
  /** An optional callback that will be called when any fiber completes with a exit */
  readonly onFiberCompleted?: (fiber: Fiber.Fiber<any, any>, exit: Exit.Exit<any, any>) => void
}): void => {
  // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- accessing Effect's global fiber tracking via well-known symbol keys
  const _globalThis = globalThis as any as GlobalWithFiberCurrent
  if (_globalThis['effect/DevtoolsHook'] !== undefined) {
    return console.error(
      'attachDebugInstrumentation has already been called! To show the tree, call attachDebugInstrumentation() in the root/main file of your program to ensure it is loaded as soon as possible.',
    )
  }
  patchScopeClose = options.patchScopeClose ?? false
  onFiberResumed = options.onFiberResumed
  onFiberSuspended = options.onFiberSuspended
  onFiberCompleted = options.onFiberCompleted
  let lastFiber: undefined | Fiber.Fiber<any, any>
  // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- accessing Effect's global fiber tracking via well-known symbol keys
  createPropertyInterceptor(globalThis as any as GlobalWithFiberCurrent, '~effect/Fiber/currentFiber', (value) => {
    if (value !== undefined && knownFibers.has(value) === true) onFiberResumed?.(value)
    if (value !== undefined) ensureFiberPatched(value)
    if (value == null && lastFiber !== undefined && knownFibers.has(lastFiber) === true) onFiberSuspended?.(lastFiber)
    lastFiber = value
  })
  _globalThis['effect/DevtoolsHook'] = {
    onEvent: (event) => {
      console.log('onEvent', event)
      switch (event._tag) {
        case 'ScopeAllocated':
          ensureScopePatched(event.scope, _globalThis['~effect/Fiber/currentFiber'])
          break
        case 'FiberAllocated':
          ensureFiberPatched(event.fiber)
          break
      }
    },
  }
}

const formatDuration = (startTime: bigint, endTime: bigint | undefined): string => {
  if (endTime === undefined) return '[running]'
  const durationMs = Number(endTime - startTime) / 1000000 // Convert nanoseconds to milliseconds
  if (durationMs < 1000) return `${durationMs.toFixed(0)}ms`
  if (durationMs < 60000) return `${(durationMs / 1000).toFixed(2)}s`
  return `${(durationMs / 60000).toFixed(2)}m`
}

const getSpanName = (span: Tracer.AnySpan): string => {
  if (span._tag === 'ExternalSpan') return `[external] ${span.spanId}`
  return span.name
}

const getSpanStatus = (info: GraphNodeInfo): string => {
  if (info.span._tag === 'ExternalSpan') return '?'
  if (info.exitTag === 'Success') return '✓'
  if (info.exitTag === 'Failure') return '✗'
  if (info.exitTag === 'Interrupted') return '!'
  return '⋮'
}

const getSpanDuration = (span: Tracer.AnySpan): string => {
  if (span._tag === 'ExternalSpan') return ''
  const endTime = span.status._tag === 'Ended' ? span.status.endTime : undefined
  return formatDuration(span.status.startTime, endTime)
}

const filterGraphKeepAncestors = <N, E>(
  graph: Graph.Graph<N, E>,
  predicate: (nodeData: N, nodeId: number) => boolean,
): Graph.Graph<N, E> => {
  // Find all root nodes (nodes with no incoming edges)
  const rootNodes = Array.from(Graph.indices(Graph.externals(graph, { direction: 'incoming' })))
  const shouldInclude = new Set<number>()

  // Use postorder DFS to evaluate children before parents
  for (const nodeId of Graph.indices(Graph.dfsPostOrder(graph, { start: rootNodes, direction: 'outgoing' }))) {
    const node = Graph.getNode(graph, nodeId)
    if (Option.isNone(node) === true) continue

    const matchesPredicate = predicate(node.value, nodeId)
    if (matchesPredicate === true) {
      shouldInclude.add(nodeId)
    } else {
      const children = Graph.neighborsDirected(graph, nodeId, 'outgoing')
      const hasMatchingChildren = children.some((childId) => shouldInclude.has(childId))
      if (hasMatchingChildren === true) shouldInclude.add(nodeId)
    }
  }

  // Create a filtered copy of the graph
  return Graph.mutate(graph, (mutable) => {
    for (const [nodeId] of mutable.nodes) {
      if (shouldInclude.has(nodeId) === true) continue
      Graph.removeNode(mutable, nodeId)
    }
  })
}

const renderSpanNode = (graph: Graph.Graph<GraphNodeInfo, void>, nodeId: number): string[] => {
  const node = Graph.getNode(graph, nodeId)
  if (Option.isNone(node) === true) return []
  const info = node.value
  const status = getSpanStatus(info)
  const name = getSpanName(info.span)
  const duration = getSpanDuration(info.span)
  const durationStr = duration !== undefined ? ` ${duration}` : ''

  const fiberIds = Array.from(knownFibers)
    .filter(
      (fiber) => fiber.currentSpan?.spanId === info.span.spanId && fiber.currentSpan?.traceId === info.span.traceId,
    )
    .map((fiber) => `#${fiber.id}`)
    .join(', ')
  const runningOnFibers = fiberIds.length > 0 ? ` [fibers ${fiberIds}]` : ''

  return [` ${status} ${name}${durationStr}${runningOnFibers}`]
}

const renderTree = <N, E, T extends Graph.Kind>(
  graph: Graph.Graph<N, E, T>,
  nodeIds: Array<number>,
  renderNode: (graph: Graph.Graph<N, E, T>, nodeId: number) => string[],
): string[] => {
  let lines: string[] = []
  for (let childIndex = 0; childIndex < nodeIds.length; childIndex++) {
    const isLastChild = childIndex === nodeIds.length - 1
    const childLines = renderNode(graph, nodeIds[childIndex]!).concat(
      renderTree(graph, Graph.neighborsDirected(graph, nodeIds[childIndex]!, 'outgoing'), renderNode),
    )
    lines = [
      ...lines,
      ...childLines.map((l, lineIndex) => {
        if (lineIndex === 0) {
          return (isLastChild === true ? ' └─' : ' ├─') + l
        }
        return (isLastChild === true ? '  ' : ' │') + l
      }),
    ]
  }

  return lines
}

export interface LogDebugOptions {
  readonly regex?: RegExp
  readonly title?: string
}

export const logDebug = (options: LogDebugOptions = {}) => {
  // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- accessing Effect's global fiber tracking via well-known symbol keys
  const _globalThis = globalThis as any as GlobalWithFiberCurrent
  if (_globalThis['effect/DevtoolsHook'] == null) {
    return console.error(
      'attachDebugInstrumentation has not been called! To show the tree, call attachDebugInstrumentation() in the root/main file of your program to ensure it is loaded as soon as possible.',
    )
  }

  let lines: Array<string> = [`----------------${options.title ?? ''}----------------`]

  // fibers
  lines = [...lines, 'Active Fibers:']
  for (const fiber of knownFibers) {
    const interruptible = (fiber as Fiber.Fiber<any, any> & { readonly interruptible?: boolean }).interruptible
    lines = [...lines, `- #${fiber.id}${interruptible === false ? ' [uninterruptible]' : ''}`]
  }
  if (knownFibers.size === 0) {
    lines = [...lines, '- No active effect fibers']
  }
  lines = [...lines, '']

  // spans
  for (const [traceId, info] of graphByTraceId) {
    const graph = Graph.endMutation(info.graph)
    const filteredGraph =
      options.regex !== undefined
        ? filterGraphKeepAncestors(graph, (nodeData, _nodeId) => {
            const name = getSpanName(nodeData.span)
            return options.regex!.test(name)
          })
        : graph
    const filteredRootNodes = Array.from(Graph.indices(Graph.externals(filteredGraph, { direction: 'incoming' })))

    lines = [...lines, `Spans Trace ${traceId}:`, ...renderTree(filteredGraph, filteredRootNodes, renderSpanNode)]
  }
  lines = [...lines, '? external span - ✓ success - ✗ failure - ! interrupted', '']

  // scopes
  lines = [...lines, 'Open Scopes:']
  for (const [scope, info] of knownScopes) {
    const fiberIds = Array.from(knownFibers)
      .filter((fiber) => Context.getOrElse(fiber.context, Scope.Scope, () => undefined) === scope)
      .map((fiber) => `#${fiber.id}`)
      .join(', ')
    const usedByFibers = fiberIds.length > 0 ? ` [used by: ${fiberIds}]` : ''
    const allocationFiber =
      info.allocationFiber !== undefined ? ` [allocated in fiber #${info.allocationFiber.id}]` : ''
    const allocationSpan =
      info.allocationSpan !== undefined ? ` [allocated in span: ${getSpanName(info.allocationSpan)}]` : ''
    lines = [...lines, `- #${info.id}${usedByFibers}${allocationFiber}${allocationSpan}`]
  }
  if (knownScopes.size === 0) {
    lines = [...lines, '- No active scopes']
  }
  lines = [...lines, '']

  console.log(lines.join('\n'))
}
