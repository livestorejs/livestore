import path from 'node:path'
import process from 'node:process'

export const EFFECT_VERSION = '4.0.0-rc.111'
/** Needs to align with Expo's React version */
export const REACT_VERSION = '19.1.0'
export const MIN_NODE_VERSION = '23.0.0'

export const DISCORD_INVITE_URL = 'https://discord.gg/RbMcjUAPd7'

// An exported-but-empty WORKSPACE_ROOT is treated as unset so the path stays
// repo-root-relative instead of silently resolving against process.cwd().
const workspaceRoot = process.env.WORKSPACE_ROOT || path.resolve(import.meta.dirname, '../../../..')

export const LIVESTORE_DEVTOOLS_CHROME_DIST_PATH = path.resolve(workspaceRoot, 'tmp/devtools/chrome-extension')
