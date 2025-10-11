import { createFileRoute } from '@tanstack/react-router'

import { Board } from '@/components/layout/board'

export const Route = createFileRoute('/board')({
  component: Board,
})
