import { TrashIcon } from '@heroicons/react/16/solid'
import React from 'react'
import { Button } from 'react-aria-components'
import { useNavigate } from 'react-router-dom'

export const ResetButton = () => {
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
    <Button
      aria-label="Delete issue"
      onPress={onClick}
      className={`rounded-lg h-7 px-2 flex items-center justify-center focus-outline-none bg-gray-700 hover:bg-gray-600 focus:outline-none focus:bg-gray-600 ${confirm ? 'text-red-500' : 'text-gray-300'}`}
    >
      <TrashIcon className="size-3.5" />
      <span className="ml-1.5 mr-1 font-medium">{confirm ? 'Confirm reset' : 'Reset database'}</span>
    </Button>
  )
}
