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
      className="rounded-lg size-8 shrink-0 flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-800 focus:outline-none focus:bg-neutral-100 dark:focus:bg-neutral-800"
    >
      <XMarkIcon className="size-5" />
    </Button>
  )
}
