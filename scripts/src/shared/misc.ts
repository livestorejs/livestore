import path from 'node:path'
import { Effect, FileSystem, Schema } from '@livestore/utils/effect'
import { cmd } from '@livestore/utils-dev/node'

/**
 * Given the LiveStore monorepo is sometimes embedded in another git repo as a submodule,
 * we sometime want to check for this situation.
 */
export const hasParentGitRepo = Effect.gen(function* () {
  const workspaceParentDir = path.resolve(process.env.WORKSPACE_ROOT!, '..')
  return yield* cmd(['git', '-C', workspaceParentDir, 'rev-parse', '--is-inside-work-tree'], {
    cwd: workspaceParentDir,
    stdout: 'pipe', // ignore output
    stderr: 'pipe', // ignore error
  }).pipe(Effect.isSuccess)
})

export class GithubSummaryWriteError extends Schema.TaggedError<GithubSummaryWriteError>()('GithubSummaryWriteError', {
  context: Schema.String,
  message: Schema.String,
  path: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

const sanitizeMarkdownCell = (value: string) => value.replaceAll('|', '\\|').replaceAll('\n', ' ')

export const formatMarkdownTable = ({
  title,
  headers,
  rows,
  emptyMessage = '_No entries._',
}: {
  title: string
  headers: ReadonlyArray<string>
  rows: ReadonlyArray<ReadonlyArray<string>>
  emptyMessage?: string
}) => {
  if (rows.length === 0) {
    return `\n## ${title}\n\n${emptyMessage}\n`
  }

  const headerLine = `| ${headers.map(sanitizeMarkdownCell).join(' | ')} |\n`
  const separatorLine = `| ${headers.map(() => '---').join(' | ')} |\n`
  const rowLines = rows.map((cells) => `| ${cells.map((cell) => sanitizeMarkdownCell(cell)).join(' | ')} |`).join('\n')

  return `\n## ${title}\n\n${headerLine}${separatorLine}${rowLines}\n`
}

export const appendGithubSummaryMarkdown = ({ markdown, context }: { markdown: string; context: string }) =>
  Effect.gen(function* () {
    const summaryPath = process.env.GITHUB_STEP_SUMMARY

    if (!summaryPath || summaryPath.trim() === '') {
      yield* Effect.logDebug(`GITHUB_STEP_SUMMARY not set; skipping ${context} summary emission`)
      return
    }

    const fs = yield* FileSystem.FileSystem

    const writeResult = yield* fs.writeFileString(summaryPath, markdown, { flag: 'a' }).pipe(
      Effect.mapError(
        (cause) =>
          new GithubSummaryWriteError({
            context,
            message: 'Failed to append markdown to GitHub run summary',
            path: summaryPath,
            cause,
          }),
      ),
      Effect.either,
    )

    if (writeResult._tag === 'Left') {
      const error = writeResult.left
      yield* Effect.logWarning(`Unable to append ${context} summary to ${summaryPath}: ${error.message}`)
      return
    }

    yield* Effect.log(`Appended ${context} summary to ${summaryPath}`)
  })
