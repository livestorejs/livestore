import { shouldNeverHappen } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'

import type { MainDatabase } from '../database.js'
import type { LiveStoreSchema } from '../schema/index.js'
import type { MutationDef } from '../schema/mutations.js'
import type { SchemaMutationsMetaRow } from '../schema/system-tables.js'
import { SCHEMA_MUTATIONS_META_TABLE, schemaMutationsMetaTable } from '../schema/system-tables.js'
import { sql } from '../util.js'
import { dbExecute, dbSelect } from './common.js'
import { migrateTable } from './migrations.js'

export const validateSchema = (schema: LiveStoreSchema, schemaManager: SchemaManager) => {
  // Validate mutation definitions
  const registeredMutationDefInfos = schemaManager.getMutationDefInfos()

  const missingMutationDefs = registeredMutationDefInfos.filter(
    (registeredMutationDefInfo) => !schema.mutations.has(registeredMutationDefInfo.mutationName),
  )

  if (missingMutationDefs.length > 0) {
    shouldNeverHappen(
      `Missing mutation definitions: ${missingMutationDefs.map((info) => info.mutationName).join(', ')}`,
    )
  }

  for (const [, mutationDef] of schema.mutations) {
    const registeredMutationDefInfo = registeredMutationDefInfos.find((info) => info.mutationName === mutationDef.name)

    validateMutationDef(mutationDef, schemaManager, registeredMutationDefInfo)
  }

  // Validate table schemas
}

export const validateMutationDef = (
  mutationDef: MutationDef.Any,
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

interface SchemaManager {
  getMutationDefInfos: () => ReadonlyArray<MutationDefInfo>

  setMutationDefInfo: (mutationDefInfo: MutationDefInfo) => void
}

type MutationDefInfo = {
  mutationName: string
  schemaHash: number
}

export const makeSchemaManager = (db: MainDatabase): SchemaManager => {
  migrateTable({
    db,
    otelContext: otel.context.active(),
    tableAst: schemaMutationsMetaTable.sqliteDef.ast,
    behaviour: 'create-if-not-exists',
  })

  return {
    getMutationDefInfos: () => {
      const schemaMutationsMetaRows = dbSelect<SchemaMutationsMetaRow>(
        db,
        sql`SELECT * FROM ${SCHEMA_MUTATIONS_META_TABLE}`,
      )

      return schemaMutationsMetaRows
    },
    setMutationDefInfo: (info) => {
      dbExecute(
        db,
        sql`INSERT OR REPLACE INTO ${SCHEMA_MUTATIONS_META_TABLE} (mutationName, schemaHash, updatedAt) VALUES ($mutationName, $schemaHash, $updatedAt)`,
        {
          mutationName: info.mutationName,
          schemaHash: info.schemaHash,
          updatedAt: new Date().toISOString(),
        },
      )
    },
  }
}
