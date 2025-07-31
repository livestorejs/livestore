import { startWranglerDevServer } from '@livestore/utils-dev/node-vitest'

await startWranglerDevServer({ cwd: import.meta.dirname })
