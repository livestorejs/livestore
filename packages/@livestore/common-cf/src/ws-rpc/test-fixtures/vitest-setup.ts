import { startWranglerDevServerPromise } from '@livestore/utils-dev/node-vitest'

const { port } = await startWranglerDevServerPromise({ cwd: import.meta.dirname })
process.env.LIVESTORE_WS_PORT = port.toString()
