import { pnpmWorkspaceReact } from '../genie/repo.ts'

// Docs package - uses glob patterns to include all workspace packages
// Also includes the code snippets directory for documentation examples
export default pnpmWorkspaceReact('../packages/@livestore/*', '../packages/@local/*', './src/content/_assets/code')
