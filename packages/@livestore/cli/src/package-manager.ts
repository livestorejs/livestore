/**
 * Supported package managers for LiveStore projects.
 * Yarn is explicitly not supported due to compatibility issues.
 */
export type PackageManager = 'npm' | 'pnpm' | 'bun'

/**
 * Result of package manager detection.
 * Returns 'unsupported' for yarn to allow the CLI to show a warning message.
 */
export type DetectPackageManagerResult =
  | { _tag: 'supported'; pm: PackageManager }
  | { _tag: 'unsupported'; pm: 'yarn' }

/**
 * Detects the package manager used to invoke the CLI based on the `npm_config_user_agent`
 * environment variable. This env var is set by npm, pnpm, yarn, and bun when running scripts.
 *
 * - Returns 'unsupported' for yarn so the CLI can show a recommendation to use bun instead
 * - Falls back to 'bun' when detection fails (e.g., when run directly without a package manager)
 */
export const detectPackageManager = (userAgent = process.env.npm_config_user_agent ?? ''): DetectPackageManagerResult => {
  if (userAgent.startsWith('bun/')) return { _tag: 'supported', pm: 'bun' }
  if (userAgent.startsWith('pnpm/')) return { _tag: 'supported', pm: 'pnpm' }
  if (userAgent.startsWith('npm/')) return { _tag: 'supported', pm: 'npm' }
  if (userAgent.startsWith('yarn/')) return { _tag: 'unsupported', pm: 'yarn' }

  // Default to bun when the package manager can't be detected
  return { _tag: 'supported', pm: 'bun' }
}

/** Package manager command templates */
export const pmCommands = {
  install: {
    npm: 'npm install',
    pnpm: 'pnpm install',
    bun: 'bun install',
  },
  run: {
    npm: (script: string) => `npm run ${script}`,
    pnpm: (script: string) => `pnpm ${script}`,
    bun: (script: string) => `bun ${script}`,
  },
} as const
