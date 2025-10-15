import { createFileRoute, redirect } from '@tanstack/react-router'
import { generateStoreId } from '../util/store-id.ts'

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    // Generate a new store ID and redirect
    const storeId = generateStoreId()
    throw redirect({
      to: '/$storeId',
      params: { storeId },
      replace: true,
    })
  },
})
