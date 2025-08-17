import { startWranglerDevServerPromise } from '@livestore/utils-dev/node-vitest'

await startWranglerDevServerPromise({ cwd: import.meta.dirname })
