import { useFrontendState } from '@/lib/livestore/queries'
import React from 'react'
import { Input } from 'react-aria-components'

export const UserInput = () => {
  const [frontendState, setFrontendState] = useFrontendState()

  return (
    <div className="h-full flex items-center border-r border-gray-700">
      <div className="h-8 border-y border-r border-gray-700 flex items-center px-2 text-sm text-gray-400">
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
        className="h-8 px-2 border-y !border-x-0 border-gray-700 text-sm placeholder:text-gray-500 text-gray-300 w-40 bg-transparent focus:outline-none focus:ring-0 focus:border-gray-700"
      />
    </div>
  )
}
