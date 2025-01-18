import { CodeBracketIcon } from '@heroicons/react/16/solid'
import React from 'react'
import { Button } from 'react-aria-components'
import { useNavigate } from 'react-router-dom'

export const DevtoolsButton = ({ className }: { className?: string }) => {
  const navigate = useNavigate()
  const onClick = () => {
    navigate('/devtools')
  }

  return (
    <div className={`lg:h-full flex items-center ${className}`}>
      <Button
        aria-label="Download database"
        onPress={onClick}
        className="h-6 px-1.5 flex items-center gap-1 bg-orange-500 text-white rounded hover:bg-orange-400 focus:outline-none focus:bg-orange-400"
      >
        <CodeBracketIcon className="size-3.5 shrink-0" />
        <span>Devtools</span>
      </Button>
    </div>
  )
}
