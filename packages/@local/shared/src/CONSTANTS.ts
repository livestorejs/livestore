import path from 'node:path'
import process from 'node:process'

export const EFFECT_VERSION = '3.21.2'
/** Needs to align with Expo's React version */
export const REACT_VERSION = '19.1.0'
export const MIN_NODE_VERSION = '23.0.0'

export const DISCORD_INVITE_URL = 'https://discord.gg/RbMcjUAPd7'

const workspaceRoot = process.env.WORKSPACE_ROOT

if (workspaceRoot === undefined || workspaceRoot === '') {
  throw new Error('WORKSPACE_ROOT must be set')
}

export const LIVESTORE_DEVTOOLS_CHROME_DIST_PATH = path.resolve(workspaceRoot, 'tmp/devtools/chrome-extension')
