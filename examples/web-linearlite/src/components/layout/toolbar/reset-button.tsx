import { TrashIcon } from '@heroicons/react/16/solid'
import React from 'react'
import { Button } from 'react-aria-components'
import { useNavigate } from 'react-router-dom'

export const ResetButton = ({ className }: { className?: string }) => {
  const [confirm, setConfirm] = React.useState(false)
  const navigate = useNavigate()

  const onClick = () => {
    if (confirm) {
      navigate('?reset')
      window.location.reload()
    }
    setConfirm(true)
    setTimeout(() => {
      setConfirm(false)
    }, 2000)
  }

  return (
    <div className={`lg:h-full flex items-center ${className}`}>
      <Button
        aria-label="Reset database"
        onPress={onClick}
        className={`h-6 px-1.5 flex items-center gap-1 bg-neutral-800 rounded hover:bg-neutral-700 focus:outline-none focus:bg-neutral-700 ${confirm ? 'text-red-500' : 'text-neutral-400'}`}
      >
        <TrashIcon className="size-3 shrink-0" />
        <span>{confirm ? 'Confirm' : 'Reset'}</span>
      </Button>
    </div>
  )
}
