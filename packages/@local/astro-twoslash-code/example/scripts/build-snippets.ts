import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Effect } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { buildSnippets } from '@local/astro-twoslash-code'

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

PlatformNode.NodeRuntime.runMain(buildSnippets({ projectRoot }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer)))
