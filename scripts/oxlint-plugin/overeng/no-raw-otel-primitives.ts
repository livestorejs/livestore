/**
 * no-raw-otel-primitives oxlint rule.
 *
 * Bans direct use of raw Effect OpenTelemetry span/metric primitives in production code.
 * Product code should route telemetry through schema-backed contracts from
 * `@overeng/otel-contract` so span names, labels, attributes, metrics, and future
 * cardinality policy have one source of truth.
 *
 * Tracked calls:
 *
 * - `Effect.withSpan(...)`
 * - `Stream.withSpan(...)`
 * - `Effect.annotateCurrentSpan(...)`
 * - `Metric.counter(...)`
 * - `Metric.histogram(...)`
 * - `Metric.tagged(...)`
 * - `Metric.increment(...)` / `Metric.incrementBy(...)`
 * - `Metric.update(...)`
 * - Aliased namespace imports, e.g. `import { Effect as E } from 'effect'`
 * - Namespace imports, e.g. `EffectLib.Effect.withSpan(...)`
 * - Direct imported identifiers from `effect`, e.g. `withSpan(...)`
 *
 */

// NOTE: Using `any` types because oxlint JS plugin API doesn't have TypeScript definitions yet

type EffectImportTracker = {
  readonly effectNamespaces: Set<string>
  readonly streamNamespaces: Set<string>
  readonly metricNamespaces: Set<string>
  readonly effectModuleNamespaces: Set<string>
  readonly directRawCalls: Set<string>
}

const rawEffectMembers = new Set(['withSpan', 'annotateCurrentSpan'])
const rawStreamMembers = new Set(['withSpan'])
const rawMetricMembers = new Set(['counter', 'histogram', 'tagged', 'increment', 'incrementBy', 'update'])

const createTracker = (): EffectImportTracker => ({
  effectNamespaces: new Set(),
  streamNamespaces: new Set(),
  metricNamespaces: new Set(),
  effectModuleNamespaces: new Set(),
  directRawCalls: new Set(),
})

/** Track local bindings imported from the root `effect` package. */
const trackEffectImport = ({ tracker, node }: { tracker: EffectImportTracker; node: any }): void => {
  if (node.source?.value !== 'effect') return

  for (const specifier of node.specifiers ?? []) {
    if (specifier.importKind === 'type') continue

    if (specifier.type === 'ImportNamespaceSpecifier') {
      const localName = specifier.local?.name
      if (typeof localName === 'string') tracker.effectModuleNamespaces.add(localName)
      continue
    }

    if (specifier.type !== 'ImportSpecifier') continue

    const importedName = importSpecifierImportedName(specifier)
    const localName = specifier.local?.name
    if (typeof importedName !== 'string' || typeof localName !== 'string') continue

    if (importedName === 'Effect') tracker.effectNamespaces.add(localName)
    if (importedName === 'Stream') tracker.streamNamespaces.add(localName)
    if (importedName === 'Metric') tracker.metricNamespaces.add(localName)
    if (
      rawEffectMembers.has(importedName) === true ||
      rawStreamMembers.has(importedName) === true ||
      rawMetricMembers.has(importedName) === true
    ) {
      tracker.directRawCalls.add(localName)
    }
  }
}

const importSpecifierImportedName = (specifier: any): string | undefined => {
  const imported = specifier.imported
  if (imported?.type === 'Identifier') return imported.name
  if (imported?.type === 'Literal' && typeof imported.value === 'string') return imported.value
  return undefined
}

const rawOtelCallSource = ({ tracker, node }: { tracker: EffectImportTracker; node: any }): string | undefined => {
  const callee = node.callee

  if (callee?.type === 'Identifier' && tracker.directRawCalls.has(callee.name) === true) {
    if (callee.name === 'annotateCurrentSpan') return 'Effect.annotateCurrentSpan()'
    if (rawMetricMembers.has(callee.name) === true) return `Metric.${callee.name}()`
    return 'Effect.withSpan() / Stream.withSpan()'
  }

  if (callee?.type !== 'MemberExpression' || callee.computed === true) return undefined

  const propertyName = callee.property?.name
  if (typeof propertyName !== 'string') return undefined

  const object = callee.object
  if (object?.type === 'Identifier') {
    if (tracker.effectNamespaces.has(object.name) === true && rawEffectMembers.has(propertyName) === true) {
      return `Effect.${propertyName}()`
    }

    if (tracker.streamNamespaces.has(object.name) === true && rawStreamMembers.has(propertyName) === true) {
      return `Stream.${propertyName}()`
    }

    if (tracker.metricNamespaces.has(object.name) === true && rawMetricMembers.has(propertyName) === true) {
      return `Metric.${propertyName}()`
    }
  }

  const namespaceCall = rawOtelNamespaceCallSource({ tracker, callee })
  if (namespaceCall !== undefined) return namespaceCall

  return undefined
}

const rawOtelNamespaceCallSource = ({
  tracker,
  callee,
}: {
  tracker: EffectImportTracker
  callee: any
}): string | undefined => {
  const namespaceMember = callee.object
  if (namespaceMember?.type !== 'MemberExpression' || namespaceMember.computed === true) {
    return undefined
  }

  const root = namespaceMember.object
  if (root?.type !== 'Identifier') return undefined
  if (tracker.effectModuleNamespaces.has(root.name) === false) return undefined

  const namespaceName = namespaceMember.property?.name
  const propertyName = callee.property?.name
  if (namespaceName === 'Effect' && rawEffectMembers.has(propertyName) === true) {
    return `Effect.${propertyName}()`
  }
  if (namespaceName === 'Stream' && rawStreamMembers.has(propertyName) === true) {
    return `Stream.${propertyName}()`
  }
  if (namespaceName === 'Metric' && rawMetricMembers.has(propertyName) === true) {
    return `Metric.${propertyName}()`
  }

  return undefined
}

/** ESLint rule banning direct raw Effect OTEL span primitives outside approved boundaries. */
export const noRawOtelPrimitivesRule = {
  meta: {
    type: 'problem' as const,
    docs: {
      description:
        'Ban raw Effect/Stream/Metric OpenTelemetry primitives outside schema-backed OTEL contract boundaries',
      recommended: false,
    },
    messages: {
      rawOtelPrimitive:
        'Raw OTEL primitive `{{source}}` bypasses the schema-first telemetry contract. Define an `OtelOperation`/`OtelSpan`/`OtelMetric` contract in package observability code and use that instead.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context: any) {
    const tracker = createTracker()

    return {
      ImportDeclaration(node: any) {
        trackEffectImport({ tracker, node })
      },

      CallExpression(node: any) {
        const source = rawOtelCallSource({ tracker, node })
        if (source === undefined) return

        context.report({
          node,
          messageId: 'rawOtelPrimitive',
          data: { source },
        })
      },
    }
  },
}
