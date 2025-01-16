import { XMarkIcon } from '@heroicons/react/20/solid'
import React from 'react'
import { Button } from 'react-aria-components'

export const BackButton = ({ close }: { close: () => void }) => {
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [close])

  return (
    <Button
      aria-label="Back to issues"
      onPress={close}
      className="rounded-lg size-8 flex items-center justify-center hover:bg-gray-100 focus:outline-none focus:bg-gray-100"
    >
      <XMarkIcon className="size-5" />
    </Button>
  )
}
