import { pnpmWorkspaceReact } from '../../genie/repo.ts'

// Test workspace - uses glob patterns to include all workspace packages
export default pnpmWorkspaceReact('../../packages/@livestore/*', '../../packages/@local/*')
