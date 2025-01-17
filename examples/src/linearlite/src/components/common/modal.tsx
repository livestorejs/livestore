import { XMarkIcon } from '@heroicons/react/20/solid'
import React from 'react'
import { Button, Heading, ModalOverlay, Modal as ReactAriaModal } from 'react-aria-components'

export const Modal = ({
  show,
  setShow,
  title,
  children,
}: {
  show: boolean
  setShow: (show: boolean) => void
  title?: string
  children: React.ReactNode
}) => {
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShow(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <ModalOverlay
      isOpen={show}
      onOpenChange={setShow}
      className="fixed inset-0 bg-black/10 dark:bg-black/20 flex items-start justify-center p-4 pt-16 lg:pt-32"
      isDismissable
    >
      <ReactAriaModal className="relative bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 w-full max-w-xl">
        {title && (
          <div className="flex justify-between items-center p-2 pl-4 border-b border-gray-200 dark:border-gray-700">
            <Heading slot="title" className="text-lg font-bold">
              {title}
            </Heading>
          </div>
        )}
        {children}
        <Button
          slot="close"
          onPress={() => setShow(false)}
          className="absolute top-2 right-2 size-8 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:bg-gray-700 flex items-center justify-center"
        >
          <XMarkIcon className="size-5" />
        </Button>
      </ReactAriaModal>
    </ModalOverlay>
  )
}
