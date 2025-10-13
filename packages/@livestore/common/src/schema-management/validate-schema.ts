import { Effect, Schema } from '@livestore/utils/effect'

import { UnexpectedError } from '../adapter-types.ts'
import type { EventDef } from '../schema/EventDef.ts'
import type { LiveStoreSchema } from '../schema/mod.ts'
import type { EventDefInfo, SchemaManager } from './common.ts'

export const validateSchema = (schema: LiveStoreSchema, schemaManager: SchemaManager) =>
  Effect.gen(function* () {
    // Validate mutation definitions
    const registeredEventDefInfos = schemaManager.getEventDefInfos()

    const missingEventDefs = registeredEventDefInfos.filter(
      (registeredEventDefInfo) => !schema.eventsDefsMap.has(registeredEventDefInfo.eventName),
    )

    if (missingEventDefs.length > 0) {
      return yield* new UnexpectedError({
        cause: `Missing event definitions: ${missingEventDefs.map((info) => info.eventName).join(', ')}`,
      })
    }

    for (const [, eventDef] of schema.eventsDefsMap) {
      const registeredEventDefInfo = registeredEventDefInfos.find((info) => info.eventName === eventDef.name)

      validateEventDef(eventDef, schemaManager, registeredEventDefInfo)
    }

    // Validate table schemas
  })

export const validateEventDef = (
  eventDef: EventDef.AnyWithoutFn,
  schemaManager: SchemaManager,
  registeredEventDefInfo: EventDefInfo | undefined,
) => {
  const schemaHash = Schema.hash(eventDef.schema)

  if (registeredEventDefInfo === undefined) {
    schemaManager.setEventDefInfo({
      schemaHash,
      eventName: eventDef.name,
    })

    return
  }

  if (schemaHash === registeredEventDefInfo.schemaHash) return

  // TODO bring back some form of schema compatibility check (see https://github.com/livestorejs/livestore/issues/69)
  // const newSchemaIsCompatibleWithOldSchema = Schema.isSubType(jsonSchemaDefFromMgmtStore, eventDef.schema)

  // if (!newSchemaIsCompatibleWithOldSchema) {
  //   shouldNeverHappen(`Schema for mutation ${eventDef.name} has changed in an incompatible way`)
  // }

  schemaManager.setEventDefInfo({
    schemaHash,
    eventName: eventDef.name,
  })
}
