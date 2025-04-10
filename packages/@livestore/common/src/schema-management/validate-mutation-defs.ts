import { Effect, Schema } from '@livestore/utils/effect'

import { UnexpectedError } from '../adapter-types.js'
import type { LiveStoreSchema } from '../schema/mod.js'
import type { MutationDef } from '../schema/mutations.js'
import type { MutationDefInfo, SchemaManager } from './common.js'

export const validateSchema = (schema: LiveStoreSchema, schemaManager: SchemaManager) =>
  Effect.gen(function* () {
    // Validate mutation definitions
    const registeredMutationDefInfos = schemaManager.getMutationDefInfos()

    const missingMutationDefs = registeredMutationDefInfos.filter(
      (registeredMutationDefInfo) => !schema.eventsDefsMap.has(registeredMutationDefInfo.mutationName),
    )

    if (missingMutationDefs.length > 0) {
      yield* new UnexpectedError({
        cause: `Missing mutation definitions: ${missingMutationDefs.map((info) => info.mutationName).join(', ')}`,
      })
    }

    for (const [, eventDef] of schema.eventsDefsMap) {
      const registeredMutationDefInfo = registeredMutationDefInfos.find((info) => info.mutationName === eventDef.name)

      validateMutationDef(eventDef, schemaManager, registeredMutationDefInfo)
    }

    // Validate table schemas
  })

export const validateMutationDef = (
  mutationDef: MutationDef.AnyWithoutFn,
  schemaManager: SchemaManager,
  registeredMutationDefInfo: MutationDefInfo | undefined,
) => {
  const schemaHash = Schema.hash(mutationDef.schema)

  if (registeredMutationDefInfo === undefined) {
    schemaManager.setMutationDefInfo({
      schemaHash,
      mutationName: mutationDef.name,
    })

    return
  }

  if (schemaHash === registeredMutationDefInfo.schemaHash) return

  // TODO bring back some form of schema compatibility check (see https://github.com/livestorejs/livestore/issues/69)
  // const newSchemaIsCompatibleWithOldSchema = Schema.isSubType(jsonSchemaDefFromMgmtStore, mutationDef.schema)

  // if (!newSchemaIsCompatibleWithOldSchema) {
  //   shouldNeverHappen(`Schema for mutation ${mutationDef.name} has changed in an incompatible way`)
  // }

  schemaManager.setMutationDefInfo({
    schemaHash,
    mutationName: mutationDef.name,
  })
}
