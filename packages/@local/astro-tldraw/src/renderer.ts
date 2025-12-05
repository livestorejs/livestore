import crypto from 'node:crypto'
import path from 'node:path'

import { tldrawToImage } from '@kitschpatrol/tldraw-cli'
import { shouldNeverHappen } from '@livestore/utils'
import { Duration, Effect, FileSystem, Schema } from '@livestore/utils/effect'

const hashString = (value: string): string => crypto.createHash('sha256').update(value).digest('hex')

/** Timeout per render attempt - 120s to handle CI cold-start delays */
const RENDER_TIMEOUT_MS = 120_000
const MAX_RETRIES = 3
/** Delay between retries - 2s to allow system resources to stabilize */
const RETRY_DELAY_MS = 2_000

export class RenderTimeoutError extends Schema.TaggedError<RenderTimeoutError>()('Tldraw.RenderTimeoutError', {
  message: Schema.String,
  diagram: Schema.String,
  theme: Schema.String,
}) {}

export class RenderInvocationError extends Schema.TaggedError<RenderInvocationError>()('Tldraw.RenderInvocationError', {
  message: Schema.String,
  diagram: Schema.String,
  theme: Schema.String,
  cause: Schema.Any,
}) {}

export type TldrawTheme = 'light' | 'dark'

export interface RenderedSvg {
  svg: string
  theme: TldrawTheme
  contentHash: string
}

export interface RenderResult {
  lightSvg: string
  darkSvg: string
  sourceHash: string
  timestamp: string
}

/** Read and hash the .tldr file content */
export const readTldrawFile = (
  filePath: string,
): Effect.Effect<{ content: string; hash: string }, RenderInvocationError, FileSystem.FileSystem> =>
  Effect.withSpan('tldraw.read-file')(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const content = yield* fs.readFileString(filePath).pipe(
        Effect.mapError(
          (cause) =>
            new RenderInvocationError({
              message: 'Failed to read tldraw file',
              diagram: filePath,
              theme: 'both',
              cause,
            }),
        ),
      )
      const hash = hashString(content)

      yield* Effect.annotateCurrentSpan({ diagram: filePath, hash })

      return { content, hash }
    }),
  )

// NOTE: We rely on the parent process to set PUPPETEER_EXECUTABLE_PATH before
// this module is imported. See scripts/src/commands/docs.ts where we derive it
// from PLAYWRIGHT_BROWSERS_PATH for CI/dev.

/** Render a single SVG with the specified theme (with timeout and retry) */
const renderSvgWithTheme = (
  tldrPath: string,
  theme: TldrawTheme,
  tempDir: string,
): Effect.Effect<RenderedSvg, RenderTimeoutError | RenderInvocationError, FileSystem.FileSystem> =>
  Effect.withSpan('tldraw.render-svg')(
    Effect.gen(function* () {
      const isDark = theme === 'dark'
      const diagramName = path.basename(tldrPath)
      const fs = yield* FileSystem.FileSystem

      yield* Effect.annotateCurrentSpan({ diagram: diagramName, theme })

      const themeDir = path.join(tempDir, theme)

      yield* fs.makeDirectory(themeDir, { recursive: true }).pipe(
        Effect.mapError(
          (cause) =>
            new RenderInvocationError({
              message: 'Failed to create theme render directory',
              diagram: tldrPath,
              theme,
              cause,
            }),
        ),
      )

      const renderEffect = Effect.tryPromise<Array<string | Buffer>, RenderInvocationError>({
        try: () =>
          tldrawToImage(tldrPath, {
            format: 'svg',
            output: themeDir,
            dark: isDark,
            transparent: true,
            stripStyle: false,
          }),
        catch: (cause) =>
          new RenderInvocationError({
            message: 'tldrawToImage failed',
            diagram: tldrPath,
            theme,
            cause,
          }),
      }).pipe(
        Effect.timeoutFail({
          onTimeout: () =>
            new RenderTimeoutError({
              message: `Tldraw render timed out after ${RENDER_TIMEOUT_MS}ms`,
              diagram: tldrPath,
              theme,
            }),
          duration: Duration.millis(RENDER_TIMEOUT_MS),
        }),
      ) as Effect.Effect<Array<string | Buffer>, RenderTimeoutError | RenderInvocationError>

      let attempt = 1
      // retry loop with capped attempts and delay
      // using explicit loop keeps retry logging and delay simple and Effect-friendly
      while (true) {
        const attemptResult = yield* Effect.either(renderEffect)

        if (attemptResult._tag === 'Right') {
          const outputPaths = attemptResult.right.map((value) => (typeof value === 'string' ? value : value.toString()))

          if (outputPaths.length === 0) {
            return shouldNeverHappen(`No SVG generated for ${tldrPath}`)
          }
          const [svgPath] = outputPaths
          if (!svgPath) {
            return shouldNeverHappen(`SVG path is undefined for ${tldrPath}`)
          }

          const svg = yield* fs.readFileString(svgPath).pipe(
            Effect.mapError(
              (cause) =>
                new RenderInvocationError({
                  message: 'Failed to read rendered SVG',
                  diagram: tldrPath,
                  theme,
                  cause,
                }),
            ),
          )

          const contentHash = hashString(svg)

          yield* Effect.annotateCurrentSpan({ svgPath, contentHash })

          yield* fs.remove(svgPath).pipe(
            Effect.mapError(
              (cause) =>
                new RenderInvocationError({
                  message: 'Failed to clean up rendered SVG',
                  diagram: tldrPath,
                  theme,
                  cause,
                }),
            ),
          )

          return {
            svg,
            theme,
            contentHash,
          }
        }

        const error = attemptResult.left
        if (attempt >= MAX_RETRIES) {
          return yield* Effect.fail(error)
        }

        yield* Effect.logWarning(
          `Retry ${attempt}/${MAX_RETRIES - 1} for ${diagramName} (${theme}): ${
            (error as Error).message ?? String(error)
          }`,
        )
        yield* Effect.sleep(Duration.millis(RETRY_DELAY_MS))
        attempt += 1
      }
    }),
  )

/** Render both light and dark SVGs from a .tldr file */
export const renderTldrawToSvg = (
  tldrPath: string,
  tempDir: string,
): Effect.Effect<RenderResult, RenderTimeoutError | RenderInvocationError, FileSystem.FileSystem> =>
  Effect.withSpan('tldraw.render')(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      yield* fs.makeDirectory(tempDir, { recursive: true }).pipe(
        Effect.mapError(
          (cause) =>
            new RenderInvocationError({
              message: 'Failed to create temp dir',
              diagram: tldrPath,
              theme: 'both',
              cause,
            }),
        ),
      )

      const { hash: sourceHash } = yield* readTldrawFile(tldrPath)

      const [lightResult, darkResult] = yield* Effect.all([
        renderSvgWithTheme(tldrPath, 'light', tempDir),
        renderSvgWithTheme(tldrPath, 'dark', tempDir),
      ])

      const timestamp = new Date().toISOString()

      yield* Effect.annotateCurrentSpan({ sourceHash, timestamp })

      return {
        lightSvg: lightResult.svg,
        darkSvg: darkResult.svg,
        sourceHash,
        timestamp,
      }
    }),
  )

/** Get dimensions from SVG string */
export const getSvgDimensions = (
  svg: string,
): { width: number | undefined; height: number | undefined } | undefined => {
  const viewBoxMatch = svg.match(/viewBox="([^"]+)"/)
  if (viewBoxMatch?.[1]) {
    const [, , width, height] = viewBoxMatch[1].split(' ').map(Number)
    return { width, height }
  }

  const widthMatch = svg.match(/width="([^"]+)"/)
  const heightMatch = svg.match(/height="([^"]+)"/)

  if (widthMatch?.[1] && heightMatch?.[1]) {
    return {
      width: Number.parseFloat(widthMatch[1]),
      height: Number.parseFloat(heightMatch[1]),
    }
  }

  return undefined
}
