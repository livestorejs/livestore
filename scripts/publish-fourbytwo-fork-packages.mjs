#!/usr/bin/env node

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const repoRoot = resolve(import.meta.dirname, "..")
const publishRoot = join(repoRoot, ".tmp", "fourbytwo-fork-packages")
const scope = nonEmpty(process.env.FORK_NPM_SCOPE) ?? "@raymonddaikon"
const registry = nonEmpty(process.env.FORK_NPM_REGISTRY) ?? "https://npm.pkg.github.com"
const npmTag = nonEmpty(process.env.FORK_NPM_TAG) ?? "fourbytwo"
const commitSha = (process.env.FORK_SOURCE_SHA ?? process.env.GITHUB_SHA ?? spawn("git", ["rev-parse", "HEAD"]).stdout.trim()).slice(
  0,
  7,
)
const publish = process.argv.includes("--publish")
const dryRun = process.argv.includes("--dry-run")

const packageOrder = [
  "utils",
  "wa-sqlite",
  "webmesh",
  "common-cf",
  "common",
  "sqlite-wasm",
  "sync-cf",
  "devtools-web-common",
  "livestore",
  "adapter-web",
  "adapter-cloudflare",
]

const publishedName = (originalName) => {
  const shortName = originalName.replace("@livestore/", "")
  return shortName === "livestore" ? `${scope}/livestore` : `${scope}/livestore-${shortName}`
}

const packageDirs = new Map(packageOrder.map((name) => [`@livestore/${name}`, join(repoRoot, "packages", "@livestore", name)]))
const nameMap = new Map([...packageDirs.keys()].map((name) => [name, publishedName(name)]))

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"))
const writeJson = async (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`)

const sourceVersion = (await readJson(join(packageDirs.get("@livestore/livestore"), "package.json"))).version
const rootVersion = nonEmpty(process.env.FORK_PACKAGE_VERSION) ?? forkVersion(sourceVersion)

await rm(publishRoot, { recursive: true, force: true })
await mkdir(publishRoot, { recursive: true })

const summaries = []

for (const originalName of packageDirs.keys()) {
  const sourceDir = packageDirs.get(originalName)
  const sourcePackageJson = await readJson(join(sourceDir, "package.json"))
  const targetName = nameMap.get(originalName)
  const targetDir = join(publishRoot, basename(targetName))

  await mkdir(targetDir, { recursive: true })
  await copyIfPresent(join(sourceDir, "dist"), join(targetDir, "dist"))
  await copyIfPresent(join(sourceDir, "src"), join(targetDir, "src"))
  await copyIfPresent(join(sourceDir, "LICENSE"), join(targetDir, "LICENSE"))
  await copyIfPresent(join(sourceDir, "README.md"), join(targetDir, "README.md"))

  const packageJson = rewritePackageJson(sourcePackageJson, {
    originalName,
    targetName,
    version: rootVersion,
  })
  await writeJson(join(targetDir, "package.json"), packageJson)

  summaries.push({
    originalName,
    targetName,
    version: rootVersion,
    alias: `"${originalName}": "npm:${targetName}@${rootVersion}"`,
  })
}

await writeJson(join(publishRoot, "aliases.json"), summaries)

console.log(`Prepared ${summaries.length} package(s) in ${publishRoot}`)
for (const summary of summaries) console.log(`${summary.originalName} -> ${summary.targetName}@${summary.version}`)
console.log("\nConsumer aliases:")
for (const summary of summaries) console.log(`  ${summary.alias}`)

if (publish === true || dryRun === true) {
  for (const summary of summaries) {
    const targetDir = join(publishRoot, basename(summary.targetName))
    const args = ["publish", "--registry", registry, "--access", "restricted", "--tag", npmTag]
    if (dryRun === true) args.push("--dry-run")

    console.log(`\nPublishing ${summary.targetName}@${summary.version}${dryRun === true ? " (dry run)" : ""}`)
    spawn("npm", args, { cwd: targetDir, stdio: "inherit" })
  }
}

function rewritePackageJson(packageJson, { targetName, version }) {
  const rewritten = structuredClone(packageJson)
  rewritten.name = targetName
  rewritten.version = version
  rewritten.repository = {
    type: "git",
    url: "git+https://github.com/raymonddaikon/livestore.git",
  }

  if (rewritten.publishConfig?.exports !== undefined) {
    rewritten.exports = rewritten.publishConfig.exports
  }

  rewritten.publishConfig = {
    registry,
    access: "restricted",
  }

  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    if (rewritten[field] === undefined) continue
    rewritten[field] = rewriteDependencyMap(rewritten[field], version)
    if (Object.keys(rewritten[field]).length === 0) delete rewritten[field]
  }

  delete rewritten.devDependencies
  delete rewritten.scripts
  delete rewritten.$genie

  return rewritten
}

function rewriteDependencyMap(dependencies, version) {
  return Object.fromEntries(
    Object.entries(dependencies).map(([name, range]) => {
      if (nameMap.has(name)) return [name, `npm:${nameMap.get(name)}@${version}`]
      if (typeof range === "string" && range.startsWith("workspace:")) {
        throw new Error(`Cannot publish unresolved workspace dependency ${name}: ${range}`)
      }
      return [name, range]
    }),
  )
}

function forkVersion(version) {
  return `${version}.fourbytwo.${commitSha}`
}

function nonEmpty(value) {
  return value === undefined || value.trim() === "" ? undefined : value
}

async function copyIfPresent(from, to) {
  if (existsSync(from) === false) return
  await cp(from, to, { recursive: true })
}

function spawn(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  })
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with status ${result.status}\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    )
  }
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  }
}
