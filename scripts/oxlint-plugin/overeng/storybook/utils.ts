/**
 * Shared helpers for the native `overeng/storybook/*` rules.
 *
 * These reimplement the small set of helpers that the upstream
 * `eslint-plugin-storybook` rules pull from its `utils/` and from
 * `storybook/internal/csf`. They are reimplemented here (rather than imported)
 * so the rules stay dependency-free and bundle cleanly into the oxlint JS
 * plugin via `bun build src/mod.ts --bundle`.
 *
 * @see Upstream SoT: eslint-plugin-storybook `utils/index.ts` —
 *   https://github.com/storybookjs/storybook/blob/v10.4.6/code/lib/eslint-plugin/src/utils/index.ts
 * @see Upstream SoT: storybook CSF helpers `isExportStory` / `storyNameFromExport` —
 *   https://github.com/storybookjs/storybook/blob/v10.4.6/code/core/src/csf/index.ts
 *   and https://github.com/storybookjs/storybook/blob/v10.4.6/code/core/src/csf/toStartCaseStr.ts
 *
 * Reimplemented from eslint-plugin-storybook@10.4.6 / storybook@10.4.6.
 *
 * Resync: when bumping the pinned Storybook version, re-read the upstream files
 * above and reconcile. Intentional deviation: `getMetaObjectExpression` resolves
 * the `const meta = {}; export default meta` indirection by scanning the
 * `Program` body for the matching top-level `const` initializer instead of using
 * eslint scope analysis (`ASTUtils.findVariable`), because the oxlint JS plugin
 * API does not expose scope managers. This covers module-scope `const meta`,
 * which is the conventional CSF pattern.
 */

// NOTE: Using `any` types because oxlint JS plugin API doesn't have TypeScript definitions yet

/** Story include/exclude descriptors parsed from the Meta object. */
export type IncludeExcludeOptions = {
  includeStories?: string[] | RegExp | undefined
  excludeStories?: string[] | RegExp | undefined
}

/** Resolve the top-level `const <name> = <ObjectExpression>` initializer in a Program body. */
const findTopLevelConstInit = (opts: { program: any; name: string }): any => {
  const { program, name } = opts
  if (program === undefined || program === null) return null
  for (const stmt of program.body) {
    if (stmt.type !== 'VariableDeclaration') continue
    for (const decl of stmt.declarations) {
      if (decl.id?.type === 'Identifier' && decl.id.name === name) {
        return decl.init ?? null
      }
    }
  }
  return null
}

/**
 * Extract the Meta `ObjectExpression` from an `ExportDefaultDeclaration`.
 *
 * Unwraps `satisfies`/`as` expressions and resolves a top-level identifier
 * (`export default meta`) to its `const meta = {}` initializer.
 */
export const getMetaObjectExpression = (opts: { node: any; program: any }): any => {
  const { node, program } = opts
  let meta = node.declaration

  if (meta?.type === 'Identifier') {
    meta = findTopLevelConstInit({ program, name: meta.name })
  }

  if (meta?.type === 'TSAsExpression' || meta?.type === 'TSSatisfiesExpression') {
    meta = meta.expression
  }

  return meta?.type === 'ObjectExpression' ? meta : null
}

/** Read a string-array or regex descriptor (includeStories/excludeStories) from a Meta object. */
export const getDescriptor = (opts: { meta: any; propertyName: string }): string[] | RegExp | undefined => {
  const { meta, propertyName } = opts
  const property = meta?.properties?.find(
    (p: any) => 'key' in p && p.key !== undefined && 'name' in p.key && p.key.name === propertyName,
  )

  if (property === undefined || property.type === 'SpreadElement') {
    return undefined
  }

  const value = property.value
  if (value.type === 'ArrayExpression') {
    return value.elements.map((el: any) => el?.value)
  }
  if (value.type === 'Literal') {
    return value.value as string[] | RegExp
  }
  return undefined
}

/** Whether a named export key denotes a story (respecting include/exclude filters). */
export const isExportStory = (opts: { key: string; config: IncludeExcludeOptions }): boolean => {
  const { key, config } = opts
  const { includeStories, excludeStories } = config

  const matches = (descriptor: string[] | RegExp): boolean => {
    if (Array.isArray(descriptor) === true) return descriptor.includes(key)
    return descriptor.test(key)
  }

  return (
    key !== '__esModule' &&
    (includeStories === undefined || matches(includeStories)) &&
    (excludeStories === undefined || matches(excludeStories) === false)
  )
}

/** Whether an export identifier is a valid story export (story + not the order helper). */
export const isValidStoryExport = (opts: { name: string; config: IncludeExcludeOptions }): boolean => {
  const { name, config } = opts
  return isExportStory({ key: name, config }) === true && name !== '__namedExportsOrder'
}

/**
 * Convert an export name to the human-readable story name Storybook would derive.
 *
 * Mirrors `storyNameFromExport` -> `toStartCaseStr` from storybook@10.4.6.
 */
export const storyNameFromExport = (key: string): string =>
  key
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\./g, ' ')
    .replace(/([^\n])([A-Z])([a-z])/g, (_m, $1, $2, $3) => `${$1} ${$2}${$3}`)
    .replace(/([a-z])([A-Z])/g, (_m, $1, $2) => `${$1} ${$2}`)
    .replace(/([a-z])([0-9])/gi, (_m, $1, $2) => `${$1} ${$2}`)
    .replace(/([0-9])([a-z])/gi, (_m, $1, $2) => `${$1} ${$2}`)
    .replace(/(\s|^)(\w)/g, (_m, $1, $2) => `${$1}${$2.toUpperCase()}`)
    .replace(/ +/g, ' ')
    .trim()

/** Collect the exported identifiers from an `ExportNamedDeclaration` (specifiers, var, fn). */
export const getAllNamedExports = (node: any): any[] => {
  if (
    (node.declaration === null || node.declaration === undefined) &&
    node.specifiers !== undefined &&
    node.specifiers !== null
  ) {
    const acc: any[] = []
    for (const specifier of node.specifiers) {
      if (specifier.exported?.type === 'Identifier') acc.push(specifier.exported)
    }
    return acc
  }

  const decl = node.declaration
  if (decl?.type === 'VariableDeclaration') {
    const declaration = decl.declarations[0]
    if (declaration?.id?.type === 'Identifier') return [declaration.id]
  }
  if (decl?.type === 'FunctionDeclaration' && decl.id?.type === 'Identifier') {
    return [decl.id]
  }
  return []
}

/** Whether a named export node imports `storiesOf` (the legacy non-CSF API). */
export const isStoriesOfImportSpecifier = (node: any): boolean =>
  node.imported !== undefined && 'name' in node.imported && node.imported.name === 'storiesOf'
