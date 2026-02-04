import { pnpmWorkspaceReact } from '../../genie/repo.ts'

// Test workspace - uses glob patterns to include all workspace packages
// This avoids manual maintenance of transitive dependency closure
export default pnpmWorkspaceReact('../../packages/@livestore/*', '../../packages/@local/*')
