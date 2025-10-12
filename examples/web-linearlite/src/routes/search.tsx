import { createFileRoute } from '@tanstack/react-router'

import { Search } from '../components/layout/search/index.tsx'

export const Route = createFileRoute('/search')({
  component: Search,
})
