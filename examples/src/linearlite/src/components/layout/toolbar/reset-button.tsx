import { TrashIcon } from '@heroicons/react/16/solid'
import React from 'react'
import { Button } from 'react-aria-components'
import { useNavigate } from 'react-router-dom'

export const ResetButton = ({ className }: { className?: string }) => {
  const [confirm, setConfirm] = React.useState(false)
  const navigate = useNavigate()

  const onClick = () => {
    if (confirm) {
      navigate('/?reset')
      window.location.reload()
    }
    setConfirm(true)
    setTimeout(() => {
      setConfirm(false)
    }, 2000)
  }

  return (
    <div className={`lg:h-full flex items-center lg:border-r lg:border-gray-700 ${className}`}>
      <Button
        aria-label="Reset database"
        onPress={onClick}
        className={`h-8 pl-2 pr-2.5 w-full lg:w-auto border-b lg:border-t flex items-center gap-1 border-gray-700 text-sm hover:bg-gray-800 focus:outline-none ${confirm ? 'text-red-500' : 'text-gray-400'}`}
      >
        <TrashIcon className="size-3" />
        <span>{confirm ? 'Confirm' : 'Reset DB'}</span>
      </Button>
    </div>
  )
}
