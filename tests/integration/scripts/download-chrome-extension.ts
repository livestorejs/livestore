import path from 'node:path'
import { UnexpectedError } from '@livestore/common'
import { Effect, FileSystem, HttpClient, HttpClientResponse, Schema } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'
import { cmd } from '@livestore/utils-dev/node'

/** Download the latest Chrome extension from LiveStore GitHub releases */
export const downloadChromeExtension = ({ version, targetDir }: { version?: string; targetDir: string }) =>
  Effect.gen(function* () {
    const ResponseSchema = Schema.Struct({
      assets: Schema.Array(
        Schema.Struct({
          name: Schema.String,
          browser_download_url: Schema.String,
          content_type: Schema.String,
        }),
      ),
      tag_name: Schema.String,
    })

    const fs = yield* FileSystem.FileSystem

    // Check if target directory already exists and prompt for deletion
    if ((yield* fs.exists(targetDir)) === true) {
      yield* Effect.logInfo(`Target directory ${targetDir} already exists`)

      if (yield* Cli.Prompt.confirm({ message: `Delete existing directory ${targetDir}?` })) {
        yield* fs.remove(targetDir, { recursive: true })
      } else {
        yield* Effect.die('Aborting...')
      }
    }

    // Create target directory
    yield* fs.makeDirectory(targetDir, { recursive: true })

    const releaseEndpoint = version ? `tags/${version}` : 'latest'
    const releaseUrl = `https://api.github.com/repos/livestorejs/livestore/releases/${releaseEndpoint}`

    const releaseResponse = yield* HttpClient.get(releaseUrl).pipe(
      Effect.andThen(HttpClientResponse.schemaBodyJson(ResponseSchema)),
      Effect.mapError(
        (cause) => new UnexpectedError({ cause, note: `Failed to fetch release info from ${releaseUrl}` }),
      ),
    )

    // Find the Chrome extension asset
    const chromeExtensionAsset = releaseResponse.assets.find(
      (asset: any) => asset.name.includes('devtools-chrome') && asset.name.endsWith('.zip'),
    )

    if (chromeExtensionAsset === undefined) {
      return yield* Effect.fail(
        new UnexpectedError({
          cause: `Chrome extension asset not found in release ${releaseResponse.tag_name}`,
          note: 'Expected to find an asset with name containing "chrome-extension" and ending with ".zip"',
        }),
      )
    }

    yield* Effect.logInfo(
      `Downloading Chrome extension ${releaseResponse.tag_name} from ${chromeExtensionAsset.browser_download_url}`,
    )

    // Create temporary directory for download
    const tmpDir = yield* fs.makeTempDirectoryScoped({ prefix: 'chrome-ext-' })
    const zipPath = path.join(tmpDir, 'extension.zip')

    // Download the zip file
    const downloadResponse = yield* HttpClient.get(chromeExtensionAsset.browser_download_url).pipe(
      Effect.mapError(
        (cause) =>
          new UnexpectedError({
            cause,
            note: `Failed to download extension from ${chromeExtensionAsset.browser_download_url}`,
          }),
      ),
      Effect.scoped,
    )

    const zipData = yield* downloadResponse.arrayBuffer.pipe(
      Effect.mapError(
        (cause) =>
          new UnexpectedError({
            cause,
            note: 'Failed to read extension data as ArrayBuffer',
          }),
      ),
    )

    // Write zip file to temporary location
    yield* fs.writeFile(zipPath, new Uint8Array(zipData))

    // Extract zip file to target directory
    yield* extractZipFile(zipPath, targetDir)

    yield* Effect.logInfo(`Chrome extension extracted to ${targetDir}`)

    return targetDir
  }).pipe(Effect.scoped)

/** Extract a zip file using Node.js built-in modules */
const extractZipFile = (zipPath: string, targetDir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem

    // Ensure target directory exists
    yield* fs.makeDirectory(targetDir, { recursive: true })

    yield* cmd(['unzip', '-o', '-j', zipPath], { cwd: targetDir }).pipe(
      Effect.mapError(
        (cause) => new UnexpectedError({ cause, note: `Failed to extract zip file from ${zipPath} to ${targetDir}` }),
      ),
    )
  })
