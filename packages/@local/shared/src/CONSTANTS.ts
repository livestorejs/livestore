import path from 'node:path'
import process from 'node:process'

export const EFFECT_VERSION = '3.16.10'
export const REACT_VERSION = '19.0.0'
export const MIN_NODE_VERSION = '23.0.0'

export const LIVESTORE_WA_SQLITE_VERSION = '1.0.5-dev.2'

export const DISCORD_INVITE_URL = 'https://discord.gg/RbMcjUAPd7'

export const LIVESTORE_DEVTOOLS_CHROME_DIST_PATH = path.resolve(
  process.env.WORKSPACE_ROOT!,
  'tmp/devtools/chrome-extension',
)
