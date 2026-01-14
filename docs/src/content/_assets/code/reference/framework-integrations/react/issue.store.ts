import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { storeOptions } from '@livestore/livestore'
import { schema } from './issue.schema.ts'

// Define reusable store configuration with storeOptions()
// This helper provides type safety and can be reused across your app
export const issueStoreOptions = (issueId: string) =>
  storeOptions({
    storeId: `issue-${issueId}`,
    schema,
    adapter: makeInMemoryAdapter(),
  })
