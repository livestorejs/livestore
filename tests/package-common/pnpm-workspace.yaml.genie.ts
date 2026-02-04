import { pnpmWorkspace } from '../../genie/repo.ts'

// Test workspace - uses glob patterns to include all workspace packages
export default pnpmWorkspace('../../packages/@livestore/*', '../../packages/@local/*')
