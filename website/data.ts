import { execSync } from 'node:child_process'

export const officeHours = [
  'https://www.youtube.com/embed/MenhU6n0r5c', // 2
  'https://www.youtube.com/embed/2GYKgI1GU8k', // 1
]

export const getBranchName = () => {
  if (process.env.GITHUB_REF_NAME) {
    return process.env.GITHUB_REF_NAME
  }
  return execSync('git rev-parse --abbrev-ref HEAD').toString().trim()
}

export const IS_MAIN_BRANCH = process.env.GITHUB_REF_NAME
  ? process.env.GITHUB_REF_NAME === 'main'
  : getBranchName() === 'main'

export const makeTiged = (example: string) => {
  const hashSuffix = IS_MAIN_BRANCH ? '' : `#${getBranchName()}`
  return `bunx tiged --mode=git git@github.com:livestorejs/livestore/examples/standalone/${example}${hashSuffix} my-app`
}
