import { DatabaseAdapter, LiveStoreDatabaseAdapterInterface } from './adapter'
import { ElectricConfig } from 'electric-sql/config'
import { electrify as baseElectrify, ElectrifyOptions } from 'electric-sql/electric'
import { WebSocketWeb } from 'electric-sql/sockets/web'
import { ElectricClient, DbSchema } from 'electric-sql/client/model'
import { Store, computed } from '@livestore/livestore'
import { useTemporaryQuery } from '@livestore/livestore/react'

export { makeElectricLiveStoreContext } from './context'
export { DatabaseAdapter }

export interface LiveStoreElectrifyOptions extends ElectrifyOptions {
  adapter?: LiveStoreDatabaseAdapterInterface
}

export const electrify = async <T extends Store, DB extends DbSchema<any>>(
  store: T,
  dbDescription: DB,
  config: ElectricConfig,
  opts?: LiveStoreElectrifyOptions,
): Promise<ElectricClient<DB>> => {
  const dbName = store.db.storageDb.filename // use the storage database name as the electric database name

  // Modify the migrations in dbDescription to use `CREATE TABLE IF NOT EXISTS` instead of `CREATE TABLE`
  // This is a bit of a hack until electric supports client side schema migrations and validation
  // It is the responsibility of the user to ensure that the schema is correct
  dbDescription.migrations = dbDescription.migrations.map((migration) => {
    migration.statements = migration.statements.map((statement) => {
      if (statement.startsWith('CREATE TABLE')) {
        statement = statement.replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS')
      }
      return statement
    })
    return migration
  })

  const adapter = opts?.adapter || new DatabaseAdapter(store, dbDescription)
  const socketFactory = opts?.socketFactory || WebSocketWeb

  const electric = await baseElectrify(dbName, dbDescription, adapter, socketFactory, config, opts)

  // Hack to disable polling
  ;(electric.satellite as any).opts.pollingInterval = Infinity
  clearInterval((electric.satellite as any)._pollingInterval)

  return electric
}
