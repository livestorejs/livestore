import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    // Generate a new store ID and redirect
    const storeId = crypto.randomUUID()
    throw redirect({
      to: '/$storeId',
      params: { storeId },
      replace: true,
    })
  },
})
