import type { MainDatabase } from '@livestore/common'
import { sql } from '@livestore/common'
import type { LiveStoreSchema, MutationDef, SchemaMutationsMetaRow } from '@livestore/common/schema'
import { SCHEMA_MUTATIONS_META_TABLE } from '@livestore/common/schema'
import { shouldNeverHappen } from '@livestore/utils'
import { JSONSchema, Schema, SchemaAST } from '@livestore/utils/effect'

import { dbExecute, dbSelect } from './common.js'

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
  console.log(mutationDef.schema.ast)
  const makeJsonSchemaStr = () =>
    JSON.stringify(JSONSchema.make(Schema.make(SchemaAST.typeAST(mutationDef.schema.ast))))

  if (registeredMutationDefInfo === undefined) {
    schemaManager.setMutationDefInfo({
      schemaHash,
      jsonSchemaStr: makeJsonSchemaStr(),
      mutationName: mutationDef.name,
    })

    return
  }

  if (schemaHash === registeredMutationDefInfo.schemaHash) return

  // Alternatively instead of first re-creating an Effect schema from the JSONSchema and then doing the sub-type check,
  // we could also consider doing the sub-type check directly on the JSONSchema.
  // (Which would require a TS implementation of https://github.com/IBM/jsonsubschema)
  const jsonSchemaDefFromMgmtStore = Schema.decodeJSONSchema(JSON.parse(registeredMutationDefInfo.jsonSchemaStr))
  const newSchemaIsCompatibleWithOldSchema = Schema.isSubType(jsonSchemaDefFromMgmtStore, mutationDef.schema)

  if (!newSchemaIsCompatibleWithOldSchema) {
    shouldNeverHappen(`Schema for mutation ${mutationDef.name} has changed in an incompatible way`)
  }

  schemaManager.setMutationDefInfo({
    schemaHash,
    jsonSchemaStr: makeJsonSchemaStr(),
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
  jsonSchemaStr: string
}

export const makeSchemaManager = (db: MainDatabase): SchemaManager => {
  // TODO reuse `migrateTable` from `migrations.ts`
  dbExecute(
    db,
    // TODO use schema migration definition from schema.ts instead
    sql`create table if not exists ${SCHEMA_MUTATIONS_META_TABLE} (mutationName text primary key, schemaHash text, jsonSchemaStr text, updatedAt text);`,
  )

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
        sql`INSERT OR REPLACE INTO ${SCHEMA_MUTATIONS_META_TABLE} (mutationName, schemaHash, jsonSchemaStr, updatedAt) VALUES ($mutationName, $schemaHash, $jsonSchemaStr, $updatedAt)`,
        {
          mutationName: info.mutationName,
          schemaHash: info.schemaHash,
          jsonSchemaStr: info.jsonSchemaStr,
          updatedAt: new Date().toISOString(),
        },
      )
    },
  }
}
