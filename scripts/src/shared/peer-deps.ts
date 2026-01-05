/**
 * Peer Dependency Checker - Validates peer dependencies against resolved versions
 *
 * Parses the bun.lock to find all packages and their peer dependencies,
 * then checks if the resolved versions satisfy those requirements.
 */

import path from 'node:path'
import { Console, Effect, FileSystem, Schema } from '@livestore/utils/effect'
import { LivestoreWorkspace } from '@livestore/utils-dev/node'
import semver from 'semver'

/** Represents a single peer dependency violation */
export interface PeerDepViolation {
  /** The package that has the peer dependency requirement */
  package: string
  /** Version of the package that has the requirement */
  packageVersion: string
  /** The peer dependency package name */
  peerDep: string
  /** The required version range for the peer dependency */
  requiredVersion: string
  /** The version that was actually resolved */
  resolvedVersion: string
}

export class PeerDepCheckError extends Schema.TaggedError<PeerDepCheckError>()('PeerDepCheckError', {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Parses a package specifier like "@effect/platform-node-shared@0.51.6" into name and version
 */
const parsePackageSpec = (spec: string): { name: string; version: string } | undefined => {
  // Handle scoped packages (@scope/name@version)
  const scopedMatch = spec.match(/^(@[^@]+)@([^@(]+)/)
  if (scopedMatch) {
    return { name: scopedMatch[1]!, version: scopedMatch[2]! }
  }

  // Handle regular packages (name@version)
  const regularMatch = spec.match(/^([^@]+)@([^@(]+)/)
  if (regularMatch) {
    return { name: regularMatch[1]!, version: regularMatch[2]! }
  }

  return undefined
}

interface BunLockfilePackageMeta {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalPeers?: string[]
}

type BunLockfilePackageEntry =
  | [string]
  | [string, string]
  | [string, string, BunLockfilePackageMeta]
  | [string, string, BunLockfilePackageMeta, string]

const ignoredPeerViolations = new Set([
  // rwsdk currently targets React 19 canary builds; we stay on stable 19.1.0 until upstream aligns
  'rwsdk->react',
  'rwsdk->react-dom',
  'rwsdk->react-server-dom-webpack',
])

interface BunLockfile {
  lockfileVersion?: number
  workspaces?: Record<
    string,
    {
      name?: string
      version?: string
    }
  >
  packages?: Record<string, BunLockfilePackageEntry>
}

/** bun.lock is JSON-ish and allows trailing commas, so normalize before JSON.parse. */
const stripTrailingCommas = (input: string) => {
  let output = ''
  let inString = false
  let isEscaped = false

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!

    if (inString) {
      output += char
      if (isEscaped) {
        isEscaped = false
        continue
      }
      if (char === '\\') {
        isEscaped = true
        continue
      }
      if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      output += char
      continue
    }

    if (char === ',') {
      let lookahead = index + 1
      while (lookahead < input.length && /\s/.test(input[lookahead]!)) {
        lookahead += 1
      }
      const nextChar = input[lookahead]
      if (nextChar === '}' || nextChar === ']') {
        continue
      }
    }

    output += char
  }

  return output
}

/**
 * Checks all peer dependencies in the lockfile are satisfied
 */
export const checkPeerDependencies = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const workspaceRoot = yield* LivestoreWorkspace
  const lockfilePath = path.join(workspaceRoot, 'bun.lock')

  // Read and parse the lockfile
  const lockfileContent = yield* fs
    .readFileString(lockfilePath)
    .pipe(Effect.mapError((cause) => new PeerDepCheckError({ message: `Failed to read bun.lock`, cause })))

  const lockfile = yield* Effect.try({
    try: () => JSON.parse(stripTrailingCommas(lockfileContent)) as BunLockfile,
    catch: (cause) => new PeerDepCheckError({ message: `Failed to parse bun.lock`, cause }),
  })

  const packages = lockfile.packages ?? {}
  const workspaces = lockfile.workspaces ?? {}

  // Build a map of resolved package versions from the lockfile packages
  // Key: package name, Value: Set of resolved versions
  const resolvedVersions = new Map<string, Set<string>>()

  for (const packageEntry of Object.values(packages)) {
    const parsed = parsePackageSpec(packageEntry[0])
    if (parsed) {
      if (!resolvedVersions.has(parsed.name)) {
        resolvedVersions.set(parsed.name, new Set())
      }
      resolvedVersions.get(parsed.name)!.add(parsed.version)
    }
  }

  for (const workspace of Object.values(workspaces)) {
    if (!workspace?.name || !workspace?.version) continue
    if (!resolvedVersions.has(workspace.name)) {
      resolvedVersions.set(workspace.name, new Set())
    }
    resolvedVersions.get(workspace.name)!.add(workspace.version)
  }

  const violations: PeerDepViolation[] = []

  // Check peer dependencies defined in the lockfile packages
  for (const packageEntry of Object.values(packages)) {
    const parsed = parsePackageSpec(packageEntry[0])
    const packageData = packageEntry[2]
    if (!parsed || !packageData?.peerDependencies) continue

    for (const [peerDep, requiredRange] of Object.entries(packageData.peerDependencies)) {
      const ignoreKey = `${parsed.name}->${peerDep}`
      if (ignoredPeerViolations.has(ignoreKey)) continue

      const isOptional = packageData.optionalPeers?.includes(peerDep) === true
      if (isOptional) continue

      const resolvedSet = resolvedVersions.get(peerDep)

      if (!resolvedSet || resolvedSet.size === 0) {
        // Peer dependency not found at all - this might be optional or provided differently
        continue
      }

      // Check if any resolved version satisfies the requirement
      let satisfied = false
      let bestResolvedVersion: string | undefined

      for (const resolvedVersion of resolvedSet) {
        bestResolvedVersion = resolvedVersion
        if (semver.satisfies(resolvedVersion, requiredRange, { loose: true })) {
          satisfied = true
          break
        }
      }

      if (!satisfied && bestResolvedVersion) {
        violations.push({
          package: parsed.name,
          packageVersion: parsed.version,
          peerDep,
          requiredVersion: requiredRange,
          resolvedVersion: bestResolvedVersion,
        })
      }
    }
  }

  return violations
}).pipe(Effect.withSpan('checkPeerDependencies'))

/**
 * Runs the peer dependency check and reports results
 */
export const runPeerDepCheck = Effect.gen(function* () {
  yield* Console.log('Checking peer dependencies...')

  const violations = yield* checkPeerDependencies

  if (violations.length === 0) {
    yield* Console.log('All peer dependencies are satisfied')
    return true
  }

  yield* Console.error(`Found ${violations.length} peer dependency violation(s):`)
  yield* Console.log('')

  // Group violations by the peer dependency that's not satisfied
  const byPeerDep = new Map<string, PeerDepViolation[]>()
  for (const v of violations) {
    const key = v.peerDep
    if (!byPeerDep.has(key)) {
      byPeerDep.set(key, [])
    }
    byPeerDep.get(key)!.push(v)
  }

  for (const [peerDep, depViolations] of byPeerDep) {
    const firstViolation = depViolations[0]!

    yield* Console.error(`  ${peerDep}@${firstViolation.resolvedVersion} does not satisfy:`)
    for (const v of depViolations) {
      yield* Console.error(`    - ${v.package}@${v.packageVersion} requires ${v.peerDep}@${v.requiredVersion}`)
    }
    yield* Console.log('')
  }

  return false
}).pipe(Effect.withSpan('runPeerDepCheck'))
