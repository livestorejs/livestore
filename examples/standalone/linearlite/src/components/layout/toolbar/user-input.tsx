import { useFrontendState } from '@/lib/livestore/queries'
import React from 'react'
import { Input } from 'react-aria-components'

export const UserInput = ({ className }: { className?: string }) => {
  const [frontendState, setFrontendState] = useFrontendState()

  return (
    <div className={`lg:h-full flex items-center gap-1 ${className}`}>
      <span>User:</span>
      <Input
        aria-label="Test User"
        placeholder="Test User"
        autoComplete="off"
        type="text"
        value={frontendState.user}
        onChange={(e) => setFrontendState({ ...frontendState, user: e.target.value })}
        onBlur={() => setFrontendState({ ...frontendState, user: frontendState.user || 'John Doe' })}
        className="h-6 px-1.5 bg-transparent bg-neutral-800 hover:bg-neutral-700 border-none text-xs rounded placeholder:text-neutral-500 text-neutral-300 grow lg:grow-0 lg:w-28 focus:outline-none focus:ring-0 focus:border-none focus:bg-neutral-700"
      />
    </div>
  )
}
