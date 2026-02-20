import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { Effect } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const loadReadExampleSlugs = async (workspaceRoot: string) => {
  process.env.WORKSPACE_ROOT = workspaceRoot
  const moduleHref = `${new URL('./deploy-examples.ts', import.meta.url).href}?workspaceRoot=${Date.now()}`
  const module = await import(moduleHref)
  return module.readExampleSlugs as () => Effect.Effect<ReadonlyArray<string>>
}

describe('readExampleSlugs', () => {
  it('includes only directories from examples root', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deploy-examples-'))
    tempDirs.push(workspaceRoot)

    const examplesRoot = join(workspaceRoot, 'examples')
    await mkdir(join(examplesRoot, 'web-counter'), { recursive: true })
    await mkdir(join(examplesRoot, 'web-chat'), { recursive: true })
    await writeFile(join(examplesRoot, '.gitignore'), '*\n')

    const readExampleSlugs = await loadReadExampleSlugs(workspaceRoot)
    const slugs = await Effect.runPromise(readExampleSlugs().pipe(Effect.provide(PlatformNode.NodeContext.layer)))

    expect(slugs).toEqual(['web-chat', 'web-counter'])
  })
})
