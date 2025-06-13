import fs from 'node:fs'
import path from 'node:path'

/**
 * Find the root directory of a Git repo by walking up from a start directory.
 *
 * @param {string} [startDir=process.cwd()] – the directory from which to start the search
 * @returns {string|null} – the path to the repo root, or null if none is found
 */
const findRepoRootDir = (startDir = process.cwd()) => {
  let dir = path.resolve(startDir)

  while (dir !== path.dirname(dir)) {
    const gitPath = path.join(dir, '.git')

    if (fs.existsSync(gitPath) && fs.statSync(gitPath).isDirectory()) {
      return dir
    }

    dir = path.dirname(dir)
  }

  return null
}

const repoRootDir = findRepoRootDir()
if (!repoRootDir) throw new Error('Could not find the root directory of the Git repository.')
const lineColumnRegex = /(?<fileExt>\.\w+):\d+:\d+/g

/**
 * Vitest {@link https://vitest.dev/guide/snapshot.html#custom-serializer | custom snapshot serializer} that replaces user-specific parts of a code path with placeholders.
 */
export default {
  test: (value) => typeof value === 'string' && value.includes(repoRootDir) && lineColumnRegex.test(value),

  serialize: (value, config, indentation, depth, refs, printer) => {
    const sanitized = value
      .replaceAll(repoRootDir, '<REPO_DIR>')
      .replaceAll(lineColumnRegex, '$<fileExt>:<LINE>:<COLUMN>')
    return printer(sanitized, config, indentation, depth, refs)
  },
}
