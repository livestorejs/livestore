import { makePersistedAdapter } from '@livestore/adapter-expo'
import { LiveStoreProvider } from '@livestore/react'
import { unstable_batchedUpdates as batchUpdates, SafeAreaView, Text } from 'react-native'

import { schema } from './schema.ts'

const adapter = makePersistedAdapter()

export const App = () => (
  <SafeAreaView style={{ flex: 1 }}>
    <LiveStoreProvider
      schema={schema}
      adapter={adapter}
      storeId="my-app"
      batchUpdates={batchUpdates}
      renderLoading={(status) => <Text>Loading ({status.stage})...</Text>}
      renderError={(error) => <Text>Error: {String(error)}</Text>}
    >
      {/* Your app content */}
    </LiveStoreProvider>
  </SafeAreaView>
)
