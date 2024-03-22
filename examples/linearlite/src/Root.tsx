import { LiveStoreProvider } from '@livestore/livestore/react'
import { FPSMeter } from '@schickling/fps-meter'
import { makeDb } from '@livestore/web'
import { WebWorkerStorage } from '@livestore/web/storage/web-worker'
import { schema } from './domain/schema'
import { DevtoolsLazy } from '@livestore/devtools-react'
import App from './App'
import { seed } from './domain/seed'
import LiveStoreWorker from './livestore.worker?worker'

import { v4 as uuid } from 'uuid'
import { makeElectricLiveStoreContext } from './electric-driver'
import { insecureAuthToken } from 'electric-sql/auth'
import { Electric, schema as electricSchema } from './generated/client/index.js'

export const { ElectricLiveStoreProvider, useElectric } = makeElectricLiveStoreContext<Electric>()

const electricConfig = {
  debug: import.meta.env.DEV,
  url: import.meta.env.VITE_ELECTRIC_SERVICE,
}

const electricAuthToken = insecureAuthToken({ sub: uuid() })

export default function Root() {
  const initialElectricSetup = async (electric: Electric) => {
    await electric.connect(electricAuthToken)
    const { synced } = await electric.db.issue.sync({
      include: {
        description: true,
        comment: true,
      },
    })
    await synced
  }

  return (
    <LiveStoreProvider
      schema={schema}
      fallback={<div>Loading LiveStore...</div>}
      boot={seed}
      makeDb={makeDb(() => {
        console.log('loading db')
        return WebWorkerStorage.load({ fileName: 'app.db', type: 'opfs', worker: LiveStoreWorker })
      })}
    >
      <ElectricLiveStoreProvider
        dbSchema={electricSchema}
        config={electricConfig}
        init={initialElectricSetup}
        fallback={<div>Loading Electric...</div>}
      >
        <FPSMeter className="absolute left-1/2 z-50 top-0 bg-black/30" height={40} />
        <App />
        <DevtoolsLazy schema={schema} />
      </ElectricLiveStoreProvider>
    </LiveStoreProvider>
  )
}
