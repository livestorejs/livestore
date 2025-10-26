import * as os from 'node:os'
import * as nodePath from 'node:path'
import {
  Command,
  Console,
  Effect,
  FileSystem,
  HttpClient,
  HttpClientRequest,
  Option,
  Schema,
} from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'

// Schema for GitHub API response
const GitHubContentSchema = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal('dir', 'file'),
  path: Schema.String,
  download_url: Schema.NullOr(Schema.String),
})

const GitHubContentsResponseSchema = Schema.Array(GitHubContentSchema)

// Error types
export class ExampleNotFoundError extends Schema.TaggedError<ExampleNotFoundError>()('ExampleNotFoundError', {
  exampleName: Schema.String,
  availableExamples: Schema.Array(Schema.String),
  message: Schema.String,
}) {}

export class NetworkError extends Schema.TaggedError<NetworkError>()('NetworkError', {
  cause: Schema.Unknown,
  message: Schema.String,
}) {}

export class DirectoryExistsError extends Schema.TaggedError<DirectoryExistsError>()('DirectoryExistsError', {
  path: Schema.String,
  message: Schema.String,
}) {}

// Fetch available examples from GitHub
const fetchExamples = (branch: string) =>
  Effect.gen(function* () {
    const url = `https://api.github.com/repos/livestorejs/livestore/contents/examples?ref=${branch}`

    yield* Effect.log(`Fetching examples from branch: ${branch}`)

    const request = HttpClientRequest.get(url)
    const response = yield* HttpClient.execute(request).pipe(
      Effect.scoped,
      Effect.catchAll(
        (error) =>
          new NetworkError({
            cause: error,
            message: `Failed to fetch examples from GitHub: ${error}`,
          }),
      ),
    )

    const responseText = yield* response.text

    const examples = yield* Schema.decodeUnknown(GitHubContentsResponseSchema)(JSON.parse(responseText)).pipe(
      Effect.catchAll(
        (error) =>
          new NetworkError({
            cause: error,
            message: `Failed to parse GitHub API response: ${error}`,
          }),
      ),
    )

    const exampleNames = examples
      .filter((item) => item.type === 'dir')
      .map((item) => item.name)
      .sort()

    yield* Effect.log(`Found ${exampleNames.length} examples: ${exampleNames.join(', ')}`)

    return exampleNames
  })

// Interactive example selection
const selectExample = (examples: string[]) =>
  Effect.gen(function* () {
    if (examples.length === 0) {
      return yield* Effect.fail(new Error('No examples available'))
    }

    const prompt = Cli.Prompt.select({
      message: '📦 Select a LiveStore example to create:',
      choices: examples.map((example) => ({
        title: example,
        value: example,
        description: `Create a new project using the ${example} example`,
      })),
    })

    return yield* Cli.Prompt.run(prompt)
  })

// Download and extract example using tiged approach
const downloadExample = (exampleName: string, branch: string, destinationPath: string) =>
  Effect.gen(function* () {
    yield* Console.log(`📥 Downloading example "${exampleName}" from branch "${branch}"...`)

    const tempDir = yield* Effect.sync(() => os.tmpdir())
    const tarballPath = nodePath.join(tempDir, `livestore-${branch}-${Date.now()}.tar.gz`)
    const tarballUrl = `https://api.github.com/repos/livestorejs/livestore/tarball/${branch}`

    // Download tarball directly
    const request = HttpClientRequest.get(tarballUrl)

    const response = yield* HttpClient.execute(request).pipe(
      Effect.scoped,
      Effect.catchAll(
        (error) =>
          new NetworkError({
            cause: error,
            message: `Failed to download tarball: ${error}`,
          }),
      ),
    )

    const fs = yield* FileSystem.FileSystem

    // Write tarball to temp file
    const tarballBuffer = yield* response.arrayBuffer
    yield* fs.writeFile(tarballPath, new Uint8Array(tarballBuffer))

    // Create destination directory
    yield* fs.makeDirectory(destinationPath, { recursive: true })

    // Extract the tarball to a temporary directory first
    const extractDir = nodePath.join(tempDir, `extract-${Date.now()}`)
    yield* fs.makeDirectory(extractDir, { recursive: true })

    // Extract tarball using Effect Command
    yield* Command.make('tar', '-xzf', tarballPath, '-C', extractDir).pipe(
      Command.exitCode,
      Effect.catchAll(
        (error) =>
          new NetworkError({
            cause: error,
            message: `Failed to extract tarball: ${error}`,
          }),
      ),
    )

    // Find the extracted directory (it will be named like livestorejs-livestore-{hash})
    const extractedDirs = yield* fs.readDirectory(extractDir)

    if (extractedDirs.length === 0) {
      return yield* new NetworkError({
        cause: 'No extracted directory found',
        message: 'Failed to find extracted repository directory',
      })
    }

    const repoDir = nodePath.join(extractDir, extractedDirs[0]!)
    const exampleSourcePath = nodePath.join(repoDir, 'examples', exampleName)

    // Check if the example exists
    const exampleExists = yield* fs.exists(exampleSourcePath)

    if (!exampleExists) {
      return yield* new ExampleNotFoundError({
        exampleName,
        availableExamples: [],
        message: `Example "${exampleName}" not found in the extracted repository`,
      })
    }

    // Copy the example directory contents to the destination using Effect Command
    yield* Command.make('cp', '-r', `${exampleSourcePath}/.`, destinationPath).pipe(
      Command.exitCode,
      Effect.catchAll(
        (error) =>
          new NetworkError({
            cause: error,
            message: `Failed to copy example files: ${error}`,
          }),
      ),
    )

    // Clean up extract directory
    yield* fs.remove(extractDir, { recursive: true }).pipe(Effect.catchAll(() => Effect.void))

    // Clean up tarball
    yield* fs.remove(tarballPath).pipe(Effect.catchAll(() => Effect.void))

    yield* Console.log(`✅ Example "${exampleName}" created successfully at: ${destinationPath}`)
  })

export const createCommand = Cli.Command.make(
  'create',
  {
    example: Cli.Options.text('example').pipe(
      Cli.Options.optional,
      Cli.Options.withDescription('Example name to create (bypasses interactive selection)'),
    ),
    branch: Cli.Options.text('branch').pipe(
      Cli.Options.withDefault('dev'),
      Cli.Options.withDescription('Branch to fetch examples from'),
    ),
    path: Cli.Args.text({ name: 'path' }).pipe(
      Cli.Args.optional,
      Cli.Args.withDescription('Destination path for the new project'),
    ),
  },
  Effect.fn(function* ({
    example,
    branch,
    path,
  }: {
    example: Option.Option<string>
    branch: string
    path: Option.Option<string>
  }) {
    yield* Effect.log('🚀 Creating new LiveStore project...')

    // Fetch available examples
    const examples = yield* fetchExamples(branch)

    if (examples.length === 0) {
      yield* Console.log('❌ No examples found in the repository')
      return yield* new ExampleNotFoundError({
        exampleName: '',
        availableExamples: [],
        message: 'No examples available',
      })
    }

    // Select example (from CLI option or interactive prompt)
    const selectedExample = Option.isSome(example) ? example.value : yield* selectExample(examples)

    // Validate selected example exists
    if (!examples.includes(selectedExample)) {
      yield* Console.log(`❌ Example "${selectedExample}" not found`)
      yield* Console.log(`Available examples: ${examples.join(', ')}`)
      return yield* new ExampleNotFoundError({
        exampleName: selectedExample,
        availableExamples: examples,
        message: `Example "${selectedExample}" not found`,
      })
    }

    // Determine destination path
    const destinationPath = Option.isSome(path) ? nodePath.resolve(path.value) : nodePath.resolve(selectedExample)

    // Download and extract the example
    yield* downloadExample(selectedExample, branch, destinationPath)

    // Success message
    yield* Console.log('\n🎉 Project created successfully!')
    yield* Console.log(`📁 Location: ${destinationPath}`)
    yield* Console.log('\n📋 Next steps:')
    yield* Console.log(`   cd ${nodePath.basename(destinationPath)}`)
    yield* Console.log('   pnpm install    # Install dependencies')
    yield* Console.log('   pnpm dev        # Start development server')
    yield* Console.log('\n💡 Tip: Run `git init` if you want to initialize version control')
  }),
)
