import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { storeOptions } from '@livestore/react/experimental'
import { schema } from './schema.ts'

// Define reusable store configuration with storeOptions()
// This helper provides type safety and can be reused across your app
export const issueStoreOptions = (issueId: string) =>
  storeOptions({
    storeId: `issue-${issueId}`,
    schema,
    adapter: makeInMemoryAdapter(),
    // Optional: Configure garbage collection time
    gcTime: 30_000, // 30 seconds
  })
