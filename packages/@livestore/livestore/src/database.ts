import type { PreparedBindValues } from './utils/util.js'

export interface PreparedStatement {
  execute(bindValues: PreparedBindValues | undefined): void
  select<T>(bindValues: PreparedBindValues | undefined): ReadonlyArray<T>
  finalize(): void
}

export type DatabaseApi = {
  filename: string
  prepare(sql: string): PreparedStatement
  export(): Uint8Array
}

export type DatabaseFactory = (filename: string, data: Uint8Array | undefined) => DatabaseApi | Promise<DatabaseApi>
