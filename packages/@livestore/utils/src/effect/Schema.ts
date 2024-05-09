import type { Schema } from '@effect/schema'
import { Hash } from 'effect'

export * from '@effect/schema/Schema'

// NOTE this is a temporary workaround until Effect schema has a better way to hash schemas
// https://github.com/Effect-TS/effect/issues/2719
// TODO remove this once the issue is resolved
export const hash = (schema: Schema.Schema<any>) => Hash.hash(schema.ast.toString())
