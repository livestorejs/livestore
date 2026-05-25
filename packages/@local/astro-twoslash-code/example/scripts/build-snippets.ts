import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Effect } from '@livestore/utils/effect'
import { buildSnippets } from '@local/astro-twoslash-code'

import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

NodeRuntime.runMain(buildSnippets({ projectRoot }).pipe(Effect.provide(NodeFileSystem.layer)))
