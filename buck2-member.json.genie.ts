import { jsonArtifact } from '../effect-utils/packages/@overeng/genie/src/runtime/json-artifact/mod.ts'
import type { BuckMemberManifest } from '../effect-utils/packages/@overeng/megarepo/src/buck2-manifest.ts'

const manifest = {
  schemaVersion: 1,
  cell: 'livestore',
  mount: 'repos/livestore',
  projectIgnore: [
    '**/dist',
    '**/node_modules',
    '**/node_modules/**',
    '**/target',
    '**/target/**',
    '.devenv',
    '.git',
    'buck-out',
    'node_modules',
    'target',
    'tmp',
  ],
  distOverlays: [],
  capabilities: [],
} as const satisfies BuckMemberManifest

export default jsonArtifact({ data: manifest })
