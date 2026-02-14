/**
 * LiveStore-specific package.json validation rules.
 *
 * These rules encode LiveStore's conventions for dependency management,
 * previously enforced by syncpack.
 */

import {
  type DepsToValidate,
  type ValidationIssue,
  type VersionConstraint,
  validateVersionConstraints,
} from '../../@overeng/genie/src/runtime/package-json/validation.ts'

// =============================================================================
// LiveStore-Specific Rules
// =============================================================================

/**
 * Validate that peer dependencies use explicit versions, not catalog: protocol.
 * This ensures published packages have correct version ranges for consumers.
 */
const validatePeerDepsNotCatalog = (
  packageName: string,
  peerDeps: Record<string, string> | undefined,
): ValidationIssue[] => {
  if (!peerDeps) return []

  const issues: ValidationIssue[] = []
  for (const [dep, version] of Object.entries(peerDeps)) {
    if (version === 'catalog:' || version.startsWith('catalog:')) {
      issues.push({
        severity: 'error',
        packageName,
        dependency: dep,
        message: `Peer dependency "${dep}" uses catalog: protocol. Peer deps must use explicit versions (e.g., "^19.0.0") for published packages to work correctly.`,
        rule: 'peer-deps-explicit-version',
      })
    }
  }
  return issues
}

/**
 * Validate that peer dependencies use semver ranges (^ or ~), not exact versions.
 * This allows consumers flexibility in which compatible version they use.
 */
const validatePeerDepsHaveRange = (
  packageName: string,
  peerDeps: Record<string, string> | undefined,
): ValidationIssue[] => {
  if (!peerDeps) return []

  const issues: ValidationIssue[] = []
  for (const [dep, version] of Object.entries(peerDeps)) {
    // Skip workspace and catalog protocols
    if (version.startsWith('workspace:') || version.startsWith('catalog:')) continue
    // Skip if already has a range
    if (version.startsWith('^') || version.startsWith('~') || version.startsWith('>=')) continue

    issues.push({
      severity: 'warning',
      packageName,
      dependency: dep,
      message: `Peer dependency "${dep}" has exact version "${version}". Consider using a range (e.g., "^${version}") for flexibility.`,
      rule: 'peer-deps-semver-range',
    })
  }
  return issues
}

// =============================================================================
// Version Constraints
// =============================================================================

/**
 * LiveStore-specific version constraints.
 * These override catalog versions for specific packages.
 */
export const livestoreVersionConstraints: VersionConstraint[] = [
  {
    reason: 'NativeWind/Tailwind v4 has memory leak on RN (nativewind/nativewind#1669)',
    dependency: 'tailwindcss',
    packages: ['livestore-example-expo-linearlite'],
    version: '^3.4.14',
    dependencyTypes: ['dev'],
  },
]

// =============================================================================
// Composed Validator
// =============================================================================

/**
 * Validate a package.json against LiveStore conventions.
 *
 * Rules:
 * 1. Peer deps must not use catalog: protocol
 * 2. Peer deps should have semver ranges (^, ~, >=)
 * 3. Version constraints for specific packages (e.g., Tailwind v3 for expo-linearlite)
 */
export const validateLivestorePackageJson = (packageName: string, deps: DepsToValidate): ValidationIssue[] => {
  const issues: ValidationIssue[] = []

  // Rule 1: Peer deps must not use catalog:
  issues.push(...validatePeerDepsNotCatalog(packageName, deps.peerDependencies))

  // Rule 2: Peer deps should have semver ranges
  issues.push(...validatePeerDepsHaveRange(packageName, deps.peerDependencies))

  // Rule 3: Version constraints
  issues.push(
    ...validateVersionConstraints({
      packageName,
      deps,
      constraints: livestoreVersionConstraints,
    }),
  )

  return issues
}
