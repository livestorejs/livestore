import {
  Effect,
  FileSystem,
  Headers,
  HttpLayerRouter,
  HttpPlatform,
  HttpServerResponse,
  Option,
  Path,
} from '@livestore/utils/effect'

export const SpaRoute = (options: { readonly directory: string; readonly indexFile?: string | undefined }) =>
  HttpLayerRouter.use(
    Effect.fnUntraced(function* (router) {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const httpPlatform = yield* HttpPlatform.HttpPlatform

      const directory = path.resolve(options.directory)
      const indexFileContent = yield* fs.readFile(
        path.join(path.resolve(options.directory), options.indexFile ?? 'index.html'),
      )
      const indexFileRes = HttpServerResponse.uint8Array(indexFileContent, { contentType: 'text/html' }).pipe(
        HttpServerResponse.setHeaders({ 'Cache-Control': 'no-cache, no-store, must-revalidate' }),
      )
      const fileHeaders = Headers.fromInput({
        'Cache-Control': 'public, max-age=31536000, immutable',
      })

      yield* router.add(
        'GET',
        '*',
        Effect.fnUntraced(function* (request) {
          const filePath = path.join(directory, request.url)
          const stat = (yield* Effect.option(fs.stat(filePath))).pipe(Option.filter((stat) => stat.type === 'File'))
          if (Option.isSome(stat)) {
            return yield* HttpServerResponse.file(filePath, { headers: fileHeaders }).pipe(
              Effect.provideService(HttpPlatform.HttpPlatform, httpPlatform),
            )
          }
          return indexFileRes
        }),
      )
    }),
  )
