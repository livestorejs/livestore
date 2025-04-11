import { Effect, Schema } from '@livestore/utils/effect'

import { UnexpectedError } from '../adapter-types.js'
import type { EventDef } from '../schema/EventDef.js'
import type { LiveStoreSchema } from '../schema/mod.js'
import type { EventDefInfo, SchemaManager } from './common.js'

export const validateSchema = (schema: LiveStoreSchema, schemaManager: SchemaManager) =>
  Effect.gen(function* () {
    // Validate mutation definitions
    const registeredEventDefInfos = schemaManager.getEventDefInfos()

    const missingEventDefs = registeredEventDefInfos.filter(
      (registeredEventDefInfo) => !schema.eventsDefsMap.has(registeredEventDefInfo.mutationName),
    )

    if (missingEventDefs.length > 0) {
      yield* new UnexpectedError({
        cause: `Missing mutation definitions: ${missingEventDefs.map((info) => info.mutationName).join(', ')}`,
      })
    }

    for (const [, eventDef] of schema.eventsDefsMap) {
      const registeredEventDefInfo = registeredEventDefInfos.find((info) => info.mutationName === eventDef.name)

      validateEventDef(eventDef, schemaManager, registeredEventDefInfo)
    }

    // Validate table schemas
  })

export const validateEventDef = (
  mutationDef: EventDef.AnyWithoutFn,
  schemaManager: SchemaManager,
  registeredEventDefInfo: EventDefInfo | undefined,
) => {
  const schemaHash = Schema.hash(mutationDef.schema)

  if (registeredEventDefInfo === undefined) {
    schemaManager.setEventDefInfo({
      schemaHash,
      mutationName: mutationDef.name,
    })

    return
  }

  if (schemaHash === registeredEventDefInfo.schemaHash) return

  // TODO bring back some form of schema compatibility check (see https://github.com/livestorejs/livestore/issues/69)
  // const newSchemaIsCompatibleWithOldSchema = Schema.isSubType(jsonSchemaDefFromMgmtStore, mutationDef.schema)

  // if (!newSchemaIsCompatibleWithOldSchema) {
  //   shouldNeverHappen(`Schema for mutation ${mutationDef.name} has changed in an incompatible way`)
  // }

  schemaManager.setEventDefInfo({
    schemaHash,
    mutationName: mutationDef.name,
  })
}
