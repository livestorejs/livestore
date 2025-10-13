import fs from 'node:fs'
import path from 'node:path'

import { isNotUndefined } from '@livestore/utils'
import { Effect, identity } from '@livestore/utils/effect'

export type TCmdLoggingOptions = {
  readonly logDir?: string
  readonly logFileName?: string
  readonly logRetention?: number
}

/**
 * Prepares logging directories, archives previous canonical log and prunes archives.
 * Returns the canonical current log path if logging is enabled, otherwise undefined.
 */
export const prepareCmdLogging: (options: TCmdLoggingOptions) => Effect.Effect<string | undefined, never, never> =
  Effect.fn('cmd.logging.prepare')(function* ({
    logDir,
    logFileName = 'dev.log',
    logRetention = 50,
  }: TCmdLoggingOptions) {
    if (!logDir || logDir === '') return undefined as string | undefined

    const logsDir = logDir
    const archiveDir = path.join(logsDir, 'archive')
    const currentLogPath = path.join(logsDir, logFileName)

    // Ensure directories exist
    yield* Effect.sync(() => fs.mkdirSync(archiveDir, { recursive: true }))

    // Archive previous log if present
    if (fs.existsSync(currentLogPath)) {
      const safeIso = new Date().toISOString().replaceAll(':', '-')
      const archivedBase = `${path.parse(logFileName).name}-${safeIso}.log`
      const archivedLog = path.join(archiveDir, archivedBase)
      yield* Effect.try({ try: () => fs.renameSync(currentLogPath, archivedLog), catch: identity }).pipe(
        Effect.catchAll(() =>
          Effect.try({
            try: () => {
              fs.copyFileSync(currentLogPath, archivedLog)
              fs.truncateSync(currentLogPath, 0)
            },
            catch: identity,
          }),
        ),
        Effect.ignore,
      )

      // Prune archives to retain only the newest N
      yield* Effect.try({ try: () => fs.readdirSync(archiveDir), catch: identity }).pipe(
        Effect.map((names) => names.filter((n) => n.endsWith('.log'))),
        Effect.map((names) =>
          names
            .map((name) => ({ name, mtimeMs: fs.statSync(path.join(archiveDir, name)).mtimeMs }))
            .sort((a, b) => b.mtimeMs - a.mtimeMs),
        ),
        Effect.flatMap((entries) =>
          Effect.forEach(entries.slice(logRetention), (e) =>
            Effect.try({ try: () => fs.unlinkSync(path.join(archiveDir, e.name)), catch: identity }).pipe(
              Effect.ignore,
            ),
          ),
        ),
        Effect.ignore,
      )
    }

    return currentLogPath
  })

/**
 * Given a command input, applies logging by piping output through `tee` to the
 * canonical log file. Returns the transformed input and whether a shell is required.
 */
export const applyLoggingToCommand: (
  commandInput: string | (string | undefined)[],
  options: TCmdLoggingOptions,
) => Effect.Effect<{ input: string | string[]; subshell: boolean; logPath?: string }, never, never> = Effect.fn(
  'cmd.logging.apply',
)(function* (commandInput, options) {
  const asArray = Array.isArray(commandInput)
  const parts = asArray ? (commandInput as (string | undefined)[]).filter(isNotUndefined) : undefined

  const logPath = yield* prepareCmdLogging(options)

  return {
    input: asArray ? ((parts as string[]) ?? []) : (commandInput as string),
    subshell: false,
    ...(logPath ? { logPath } : {}),
  }
})
