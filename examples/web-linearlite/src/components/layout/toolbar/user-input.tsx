import { type ChangeEvent, useCallback } from 'react'
import { Input } from 'react-aria-components'

import { useFrontendState } from '../../../livestore/queries.ts'

export const UserInput = ({ className }: { className?: string }) => {
  const [frontendState, setFrontendState] = useFrontendState()
  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => setFrontendState({ ...frontendState, user: e.target.value }),
    [frontendState, setFrontendState],
  )
  const handleBlur = useCallback(
    () => setFrontendState({ ...frontendState, user: frontendState.user || 'John Doe' }),
    [frontendState, setFrontendState],
  )

  return (
    <div className={`lg:h-full flex items-center gap-1 ${className}`}>
      <span>User:</span>
      <Input
        aria-label="Test User"
        placeholder="Test User"
        autoComplete="off"
        type="text"
        value={frontendState.user}
        onChange={handleChange}
        onBlur={handleBlur}
        className="h-6 px-1.5 bg-neutral-800 hover:bg-neutral-700 border-none text-xs rounded placeholder:text-neutral-500 text-neutral-300 grow lg:grow-0 lg:w-28 focus:outline-none focus:ring-0 focus:border-none focus:bg-neutral-700"
      />
    </div>
  )
}
