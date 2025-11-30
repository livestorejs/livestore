/**
 * Peer Dependency Checker - Validates peer dependencies against resolved versions
 *
 * Parses the pnpm-lock.yaml to find all packages and their peer dependencies,
 * then checks if the resolved versions satisfy those requirements.
 */

import path from 'node:path'
import { Console, Effect, FileSystem, Schema } from '@livestore/utils/effect'
import { LivestoreWorkspace } from '@livestore/utils-dev/node'
import semver from 'semver'
import * as yaml from 'yaml'

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

interface LockfilePackage {
  resolution?: { integrity?: string }
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

interface ParsedLockfile {
  lockfileVersion: string
  packages?: Record<string, LockfilePackage>
  snapshots?: Record<string, LockfilePackage>
}

/**
 * Checks all peer dependencies in the lockfile are satisfied
 */
export const checkPeerDependencies = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const workspaceRoot = yield* LivestoreWorkspace
  const lockfilePath = path.join(workspaceRoot, 'pnpm-lock.yaml')

  // Read and parse the lockfile
  const lockfileContent = yield* fs
    .readFileString(lockfilePath)
    .pipe(Effect.mapError((cause) => new PeerDepCheckError({ message: `Failed to read pnpm-lock.yaml`, cause })))

  const lockfile = yield* Effect.try({
    try: () => yaml.parse(lockfileContent) as ParsedLockfile,
    catch: (cause) => new PeerDepCheckError({ message: `Failed to parse pnpm-lock.yaml`, cause }),
  })

  // pnpm v9+ uses "snapshots" and "packages" separately
  // "packages" contains package metadata (including peerDependencies definitions)
  // "snapshots" contains resolved versions with peer dep context
  const packages = lockfile.packages ?? {}
  const snapshots = lockfile.snapshots ?? {}

  // Build a map of resolved package versions from snapshots
  // Key: package name, Value: Set of resolved versions
  const resolvedVersions = new Map<string, Set<string>>()

  for (const snapshotKey of Object.keys(snapshots)) {
    const parsed = parsePackageSpec(snapshotKey)
    if (parsed) {
      if (!resolvedVersions.has(parsed.name)) {
        resolvedVersions.set(parsed.name, new Set())
      }
      resolvedVersions.get(parsed.name)!.add(parsed.version)
    }
  }

  // Also add versions from the packages section
  for (const packageKey of Object.keys(packages)) {
    const parsed = parsePackageSpec(packageKey)
    if (parsed) {
      if (!resolvedVersions.has(parsed.name)) {
        resolvedVersions.set(parsed.name, new Set())
      }
      resolvedVersions.get(parsed.name)!.add(parsed.version)
    }
  }

  const violations: PeerDepViolation[] = []

  // Check peer dependencies defined in the packages section
  for (const [packageKey, packageData] of Object.entries(packages)) {
    const parsed = parsePackageSpec(packageKey)
    if (!parsed || !packageData.peerDependencies) continue

    for (const [peerDep, requiredRange] of Object.entries(packageData.peerDependencies)) {
      const isOptional = packageData.peerDependenciesMeta?.[peerDep]?.optional === true
      if (isOptional) continue

      const resolvedSet = resolvedVersions.get(peerDep)

      if (!resolvedSet || resolvedSet.size === 0) {
        // Peer dependency not found at all - this might be optional or provided differently
        // We'll skip these for now as pnpm handles optional peers
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
