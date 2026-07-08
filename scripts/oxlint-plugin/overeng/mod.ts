/**
 * @overeng/oxc-config custom oxlint rules plugin.
 *
 * This plugin provides custom lint rules for the overeng monorepo:
 * - explicit-boolean-compare: Enforce explicit boolean-literal comparisons in condition positions
 * - exports-first: Enforce exported declarations appear before non-exported declarations
 * - named-args: Enforce functions have at most one parameter (use options objects)
 * - jsdoc-require-exports: Require JSDoc comments on type/wildcard exports
 * - no-external-imports: Disallow value imports from npm packages (for dependency-free modules)
 * - no-raw-nondeterminism: Ban raw nondeterminism outside a journaled Restate.run closure
 * - no-non-durable-wait: Ban non-durable Effect.sleep/Effect.timeout outside a journaled Restate.run closure
 * - no-raw-otel-primitives: Ban raw Effect/Stream OTEL span primitives outside contract boundaries
 *
 * It also provides native reimplementations of selected Storybook CSF best-practice
 * rules under the `overeng/storybook/*` namespace (reimplemented from
 * eslint-plugin-storybook@10.4.6 — see each rule's SoT reference):
 * - storybook/meta-satisfies-type: CSF Meta should use `satisfies Meta`
 * - storybook/default-exports: a story file must have a default export (the Meta)
 * - storybook/story-exports: a story file should have at least one named story export
 * - storybook/csf-component: the Meta object should declare a `component` property
 * - storybook/hierarchy-separator: discourage the deprecated `|` separator in `title`
 * - storybook/no-redundant-story-name: a story's explicit name equal to its export name is redundant
 * - storybook/prefer-pascal-case: named story exports should be PascalCase
 *
 * TODO: Remove this custom plugin once upstream support lands.
 * See: https://github.com/oxc-project/oxc/issues/17706
 *
 * NOTE: WASM plugins may become available in the future for better performance.
 * See: https://github.com/oxc-project/oxc/discussions/10342
 */

import { explicitBooleanCompareRule } from './explicit-boolean-compare.ts'
import { exportsFirstRule } from './exports-first.ts'
import { jsdocRequireExportsRule } from './jsdoc-require-exports.ts'
import { namedArgsRule } from './named-args.ts'
import { noExternalImportsRule } from './no-external-imports.ts'
import { noNonDurableWaitRule } from './no-non-durable-wait.ts'
import { noRawNondeterminismRule } from './no-raw-nondeterminism.ts'
import { noRawOtelPrimitivesRule } from './no-raw-otel-primitives.ts'
import { otelContractInSeamFileRule } from './otel-contract-in-seam-file.ts'
import { csfComponentRule } from './storybook/csf-component.ts'
import { defaultExportsRule } from './storybook/default-exports.ts'
import { hierarchySeparatorRule } from './storybook/hierarchy-separator.ts'
import { metaSatisfiesTypeRule } from './storybook/meta-satisfies-type.ts'
import { noRedundantStoryNameRule } from './storybook/no-redundant-story-name.ts'
import { preferPascalCaseRule } from './storybook/prefer-pascal-case.ts'
import { storyExportsRule } from './storybook/story-exports.ts'

type Rules = {
  'explicit-boolean-compare': typeof explicitBooleanCompareRule
  'exports-first': typeof exportsFirstRule
  'jsdoc-require-exports': typeof jsdocRequireExportsRule
  'named-args': typeof namedArgsRule
  'no-external-imports': typeof noExternalImportsRule
  'no-non-durable-wait': typeof noNonDurableWaitRule
  'no-raw-nondeterminism': typeof noRawNondeterminismRule
  'no-raw-otel-primitives': typeof noRawOtelPrimitivesRule
  'otel-contract-in-seam-file': typeof otelContractInSeamFileRule
  'storybook/meta-satisfies-type': typeof metaSatisfiesTypeRule
  'storybook/default-exports': typeof defaultExportsRule
  'storybook/story-exports': typeof storyExportsRule
  'storybook/csf-component': typeof csfComponentRule
  'storybook/hierarchy-separator': typeof hierarchySeparatorRule
  'storybook/no-redundant-story-name': typeof noRedundantStoryNameRule
  'storybook/prefer-pascal-case': typeof preferPascalCaseRule
}

const rules: Rules = {
  // Custom overeng rules
  'explicit-boolean-compare': explicitBooleanCompareRule,
  'exports-first': exportsFirstRule,
  'jsdoc-require-exports': jsdocRequireExportsRule,
  'named-args': namedArgsRule,
  'no-external-imports': noExternalImportsRule,
  'no-non-durable-wait': noNonDurableWaitRule,
  'no-raw-nondeterminism': noRawNondeterminismRule,
  'no-raw-otel-primitives': noRawOtelPrimitivesRule,
  'otel-contract-in-seam-file': otelContractInSeamFileRule,

  // Native storybook rules (use as overeng/storybook/*)
  'storybook/meta-satisfies-type': metaSatisfiesTypeRule,
  'storybook/default-exports': defaultExportsRule,
  'storybook/story-exports': storyExportsRule,
  'storybook/csf-component': csfComponentRule,
  'storybook/hierarchy-separator': hierarchySeparatorRule,
  'storybook/no-redundant-story-name': noRedundantStoryNameRule,
  'storybook/prefer-pascal-case': preferPascalCaseRule,
}

type Plugin = {
  readonly meta: {
    readonly name: string
    readonly version: string
  }
  readonly rules: Rules
}

const plugin: Plugin = {
  meta: {
    name: 'overeng',
    version: '0.1.0',
  },
  rules,
}

export default plugin
