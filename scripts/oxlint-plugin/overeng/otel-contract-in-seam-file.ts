/**
 * otel-contract-in-seam-file oxlint rule (decision 0005; ships WARN-only initially).
 *
 * OTel semantic-convention contracts must be authored in a conventional SEAM file
 * (`*.contract.ts`) so they are discoverable by construction — the single source for BOTH the
 * Weaver registry projection AND the conformance sweep. This rule warns when a Layer-2 contract
 * constructor imported from `@overeng/otel-contract/registry` is USED outside a seam file:
 *
 * - `defineOtelContract(...)`, `span(...)`, `metric(...)`, `operation(...)`
 * - `attr.string(...)` / `attr.enum(...)` / … (member calls on the imported `attr` object)
 *
 * Path-based + single-file: this is what a lint can enforce. The keystone it cannot provide —
 * that every seam file is actually imported into the root aggregator (no orphan seam) — is a
 * separate composition test (`orphanSeamPaths`).
 */

// NOTE: Using `any` types because the oxlint JS plugin API doesn't have TypeScript definitions yet

const REGISTRY_MODULE = '@overeng/otel-contract/registry'
const DIRECT_CONSTRUCTORS = new Set(['defineOtelContract', 'span', 'metric', 'operation'])
const ATTR_BUILDER = 'attr'

type SeamImportTracker = {
  /** local names bound to a direct contract constructor imported from the registry module. */
  readonly directCalls: Set<string>
  /** local names bound to the `attr` builder object (member-called: `attr.string(...)`). */
  readonly attrObjects: Set<string>
}

const createTracker = (): SeamImportTracker => ({ directCalls: new Set(), attrObjects: new Set() })

const importedName = (specifier: any): string | undefined => {
  const imported = specifier.imported
  if (imported?.type === 'Identifier') return imported.name
  if (imported?.type === 'Literal' && typeof imported.value === 'string') return imported.value
  return undefined
}

const trackRegistryImport = ({ tracker, node }: { tracker: SeamImportTracker; node: any }): void => {
  if (node.source?.value !== REGISTRY_MODULE) return
  for (const specifier of node.specifiers ?? []) {
    if (specifier.importKind === 'type') continue
    if (specifier.type !== 'ImportSpecifier') continue
    const name = importedName(specifier)
    const local = specifier.local?.name
    if (typeof name !== 'string' || typeof local !== 'string') continue
    if (DIRECT_CONSTRUCTORS.has(name) === true) tracker.directCalls.add(local)
    if (name === ATTR_BUILDER) tracker.attrObjects.add(local)
  }
}

/** The contract-constructor source string for a call node, or undefined if it is not one. */
const contractCallSource = ({ tracker, node }: { tracker: SeamImportTracker; node: any }): string | undefined => {
  const callee = node.callee
  if (callee?.type === 'Identifier' && tracker.directCalls.has(callee.name) === true) {
    return `${callee.name}()`
  }
  // `attr.<member>(...)`
  if (callee?.type === 'MemberExpression' && callee.computed !== true) {
    const object = callee.object
    const property = callee.property?.name
    if (
      object?.type === 'Identifier' &&
      tracker.attrObjects.has(object.name) === true &&
      typeof property === 'string'
    ) {
      return `${object.name}.${property}()`
    }
  }
  return undefined
}

const isSeamFile = (filename: string): boolean => filename.endsWith('.contract.ts')

/** ESLint-shaped rule: OTel contract constructors must live in a `*.contract.ts` seam file. */
export const otelContractInSeamFileRule = {
  meta: {
    type: 'problem' as const,
    docs: {
      description:
        'OTel semantic-convention contract constructors must be authored in a `*.contract.ts` seam file so they are discoverable by construction (decision 0005)',
      recommended: false,
    },
    messages: {
      contractOutsideSeam:
        'Contract constructor `{{source}}` from `@overeng/otel-contract/registry` must live in a `*.contract.ts` seam file so it is discoverable by the registry projection + conformance sweep. Move this contract into the package’s seam file.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context: any) {
    const filename: string = context.filename ?? context.getFilename?.() ?? ''
    // Seam files are the allowed home — do not track/report there.
    if (isSeamFile(filename) === true) return {}

    const tracker = createTracker()
    return {
      ImportDeclaration(node: any) {
        trackRegistryImport({ tracker, node })
      },
      CallExpression(node: any) {
        const source = contractCallSource({ tracker, node })
        if (source === undefined) return
        context.report({ node, messageId: 'contractOutsideSeam', data: { source } })
      },
    }
  },
}
