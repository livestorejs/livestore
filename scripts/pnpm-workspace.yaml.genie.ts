import { pnpmWorkspace } from '../genie/repo.ts'

// Scripts is at repo root level, so paths need ../ prefix to reach packages/
// Also include docs/ and tests/ which are at repo root
export default pnpmWorkspace('../packages/@livestore/*', '../packages/@local/*', '../docs', '../tests/*')
