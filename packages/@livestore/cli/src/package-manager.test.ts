import { Vitest } from '@livestore/utils-dev/node-vitest'

import { detectPackageManager, pmCommands } from './package-manager.ts'

Vitest.describe('detectPackageManager', () => {
  Vitest.it('detects npm from user agent', () => {
    const result = detectPackageManager('npm/10.2.4 node/v20.11.0 darwin arm64 workspaces/false')
    Vitest.expect(result).toEqual({ _tag: 'supported', pm: 'npm' })
  })

  Vitest.it('detects pnpm as unsupported', () => {
    const result = detectPackageManager('pnpm/9.0.6 npm/? node/v22.0.0 darwin arm64')
    Vitest.expect(result).toEqual({ _tag: 'unsupported', pm: 'pnpm' })
  })

  Vitest.it('detects yarn as unsupported', () => {
    const result = detectPackageManager('yarn/1.22.19 npm/? node/v20.11.0 darwin arm64')
    Vitest.expect(result).toEqual({ _tag: 'unsupported', pm: 'yarn' })
  })

  Vitest.it('detects bun from user agent', () => {
    const result = detectPackageManager('bun/1.1.7')
    Vitest.expect(result).toEqual({ _tag: 'supported', pm: 'bun' })
  })

  Vitest.it('falls back to bun for empty user agent', () => {
    const result = detectPackageManager('')
    Vitest.expect(result).toEqual({ _tag: 'supported', pm: 'bun' })
  })

  Vitest.it('uses process.env.npm_config_user_agent when no argument provided', () => {
    const originalEnv = process.env.npm_config_user_agent
    try {
      process.env.npm_config_user_agent = 'pnpm/9.0.6'
      const result = detectPackageManager()
      Vitest.expect(result).toEqual({ _tag: 'unsupported', pm: 'pnpm' })
    } finally {
      process.env.npm_config_user_agent = originalEnv
    }
  })

  Vitest.it('falls back to bun for unknown user agent', () => {
    const result = detectPackageManager('some-unknown-tool/1.0.0')
    Vitest.expect(result).toEqual({ _tag: 'supported', pm: 'bun' })
  })
})

Vitest.describe('pmCommands', () => {
  Vitest.it('provides correct install commands for each package manager', () => {
    Vitest.expect(pmCommands.install.npm).toBe('npm install')
    Vitest.expect(pmCommands.install.bun).toBe('bun install')
  })

  Vitest.it('provides correct run commands for dev script', () => {
    Vitest.expect(pmCommands.run.npm('dev')).toBe('npm run dev')
    Vitest.expect(pmCommands.run.bun('dev')).toBe('bun dev')
  })

  Vitest.it('provides correct run commands for start script', () => {
    Vitest.expect(pmCommands.run.npm('start')).toBe('npm run start')
    Vitest.expect(pmCommands.run.bun('start')).toBe('bun start')
  })
})
