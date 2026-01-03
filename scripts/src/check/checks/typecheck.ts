import { Effect } from '@livestore/utils/effect'
import { LivestoreWorkspace } from '@livestore/utils-dev/node'

import { runCommandWithEvents } from '../runner.ts'
import type { Check } from './types.ts'

/**
 * TypeScript type checking.
 * Uses incremental build via tsc --build.
 */
export const typecheckCheck: Check = {
  type: 'typecheck',
  name: 'TypeScript',
  fast: true,
  run: runCommandWithEvents('typecheck', 'TypeScript', 'tsc --build tsconfig.dev.json').pipe(
    Effect.provide(LivestoreWorkspace.toCwd()),
  ),
}
