import { startWranglerDevServerPromise } from '@livestore/utils-dev/node'

const { port } = await startWranglerDevServerPromise({ cwd: import.meta.dirname })
process.env.LIVESTORE_SYNC_PORT = port.toString()
