import { Context, Effect, Layer, Schema } from '@livestore/utils/effect'

import type { SqliteDb } from '../adapter-types.ts'
import { type CommandInstance, CommandInstanceSchema } from '../schema/command/command-instance.ts'
import { COMMAND_JOURNAL_TABLE } from '../schema/state/sqlite/system-tables/eventlog-tables.ts'
import { prepareBindValues, sql } from '../util.ts'

/** Schema for the SQL row format of a command journal entry. */
const CommandInstanceSqlRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  args: Schema.parseJson(),
})

/** Composed schema: SQL row string → parsed fields → branded CommandInstance */
const CommandInstanceSql = Schema.compose(CommandInstanceSqlRow, CommandInstanceSchema)

const decodeCommandInstanceSqlArray = Schema.decodeUnknown(Schema.Array(CommandInstanceSql))
const encodeCommandInstanceSql = Schema.encodeSync(CommandInstanceSql)

/**
 * Append-only journal that records locally-executed commands for later replay.
 *
 * Commands are journaled after successful initial execution and removed when their resulting events are confirmed or
 * when the command fails during replay.
 */
export class CommandJournal extends Context.Tag('@livestore/common/CommandJournal')<
  CommandJournal,
  {
    /**
     * Write a command to the journal.
     *
     * @remarks Idempotent — if a command with the same ID exists, this is a no-op.
     */
    readonly write: (command: CommandInstance) => Effect.Effect<void, CommandJournalError>

    /** Read all the commands in insertion order. */
    readonly entries: Effect.Effect<ReadonlyArray<CommandInstance>, CommandJournalError>

    /**
     * Remove commands from the journal by ID.
     *
     * Used for both confirmation (corresponding events confirmed) and replay failure.
     * Non-existent IDs are silently ignored.
     */
    readonly remove: (commandIds: ReadonlyArray<string>) => Effect.Effect<void, CommandJournalError>

    /** Remove all commands */
    readonly destroy: Effect.Effect<void, CommandJournalError>
  }
>() {}

/**
 * Error raised when a {@link CommandJournal} operation fails.
 *
 * Wraps the underlying SQLite or decoding error with the journal method that triggered it.
 */
export class CommandJournalError extends Schema.TaggedError<CommandJournalError>()(
  '@livestore/common/CommandJournalError',
  {
    method: Schema.Literal('write', 'entries', 'remove', 'destroy'),
    cause: Schema.Defect,
  },
) {}

/**
 * Create a CommandJournal implementation backed by SQLite.
 *
 * @param db - The SQLite database instance (eventlog DB)
 */
export const make = (db: SqliteDb): CommandJournal['Type'] => ({
  write: (command) =>
    Effect.try({
      try: () => {
        const encoded = encodeCommandInstanceSql(command)
        const stmt = sql`INSERT OR IGNORE INTO ${COMMAND_JOURNAL_TABLE} (id, name, args)
            VALUES ($id, $name, $args)`
        db.execute(stmt, prepareBindValues({ id: encoded.id, name: encoded.name, args: encoded.args }, stmt))
      },
      catch: (cause) =>
        new CommandJournalError({
          method: 'write',
          cause,
        }),
    }),

  entries: Effect.try(() =>
    db.select(
      sql`SELECT id, name, args
          FROM ${COMMAND_JOURNAL_TABLE}
          ORDER BY rowid ASC`,
    ),
  ).pipe(
    Effect.flatMap(decodeCommandInstanceSqlArray),
    Effect.mapError((cause) => new CommandJournalError({ method: 'entries', cause })),
  ),

  remove: (commandIds) =>
    Effect.try({
      try: () => {
        if (commandIds.length === 0) return

        const placeholders = commandIds.map((_, i) => `$id${i}`).join(', ')
        const stmt = sql`DELETE FROM ${COMMAND_JOURNAL_TABLE} WHERE id IN (${placeholders})`
        const bind = Object.fromEntries(commandIds.map((id, i) => [`id${i}`, id]))
        db.execute(stmt, prepareBindValues(bind, stmt))
      },
      catch: (cause) =>
        new CommandJournalError({
          method: 'remove',
          cause,
        }),
    }),

  destroy: Effect.try({
    try: () => {
      db.execute(sql`DELETE FROM ${COMMAND_JOURNAL_TABLE}`)
    },
    catch: (cause) =>
      new CommandJournalError({
        method: 'destroy',
        cause,
      }),
  }),
})

/** Create a CommandJournal layer backed by SQLite. */
export const layer = (db: SqliteDb): Layer.Layer<CommandJournal> => Layer.succeed(CommandJournal, make(db))
