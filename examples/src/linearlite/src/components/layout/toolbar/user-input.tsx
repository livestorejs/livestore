import { useFrontendState } from '@/lib/livestore/queries'
import React from 'react'
import { Input } from 'react-aria-components'

export const UserInput = ({ className }: { className?: string }) => {
  const [frontendState, setFrontendState] = useFrontendState()

  return (
    <div className={`lg:h-full flex items-center lg:border-r lg:border-neutral-700 ${className}`}>
      <div className="h-8 lg:border-y border-r border-neutral-700 flex items-center px-2 text-sm text-neutral-400 whitespace-nowrap shrink-0">
        Test User:
      </div>
      <Input
        aria-label="Test User"
        placeholder="Test User"
        autoComplete="off"
        type="text"
        value={frontendState.user}
        onChange={(e) => setFrontendState({ ...frontendState, user: e.target.value })}
        onBlur={() => setFrontendState({ ...frontendState, user: frontendState.user || 'John Doe' })}
        className="h-8 px-2 border-y-0 lg:border-y !border-x-0 border-neutral-700 text-sm placeholder:text-neutral-500 text-neutral-300 grow lg:grow-0 lg:w-32 xl:w-40 bg-transparent focus:outline-none focus:ring-0 focus:border-neutral-700"
      />
    </div>
  )
}
