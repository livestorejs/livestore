#!/usr/bin/env bun

import { $ } from "bun"
import { existsSync } from "node:fs"

process.env.FORCE_COLOR = '1'

$.cwd(process.env.WORKSPACE_ROOT!)

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT!
const lastGitHashFile = `${WORKSPACE_ROOT}/node_modules/.last_git_hash`
const lastGitHash = existsSync(lastGitHashFile) ? await $`cat ${lastGitHashFile} 2>/dev/null`.text() : "no-git"

const currentGitHash = await $`git rev-parse HEAD 2>/dev/null || echo "no-git"`.text()

if (lastGitHash !== currentGitHash) {
  // Install node dependencies for convenience, but only if parent is not a git repo (e.g. when cloned as a submodule)
  const parentDir = (await $`dirname "$PWD"`.text()).trim()
  const parentIsGitRepo = await $`git -C ${parentDir} rev-parse --is-inside-work-tree >/dev/null`.nothrow().quiet()
  if (parentIsGitRepo.exitCode !== 0) {
    console.log("Installing node dependencies via pnpm...")
    await $`CI=1 pnpm install`
  } else {
    console.log(`Parent (${parentDir}) is a git repo, skipping node dependencies installation`)
  }

  // Run an initial TS build
  console.log("Running initial TS build...")
  await $`mono ts`

  // Update the last git hash
  await $`echo ${currentGitHash} > ${lastGitHashFile}`
}