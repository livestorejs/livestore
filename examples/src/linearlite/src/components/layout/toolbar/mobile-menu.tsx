import { ResetButton } from '@/components/layout/toolbar/reset-button'
import { SeedInput } from '@/components/layout/toolbar/seed-input'
import { UserInput } from '@/components/layout/toolbar/user-input'
import { ChevronUpIcon } from '@heroicons/react/16/solid'
import React from 'react'
import { Button, DialogTrigger, ModalOverlay, Modal as ReactAriaModal } from 'react-aria-components'

export const MobileMenu = () => {
  return (
    <div className="h-full lg:hidden items-center border-x border-gray-700 shrink-0 flex">
      <DialogTrigger>
        <Button
          aria-label="Open LiveStore tools"
          className="h-8 border-y border-gray-700 flex items-center gap-1 pr-2 pl-3 focus:outline-none hover:bg-gray-800 text-sm text-gray-400 focus:bg-gray-800"
        >
          <span>Tools</span>
          <ChevronUpIcon className="size-4" />
        </Button>
        <ModalOverlay
          className="fixed inset-0 bottom-12 bg-black/10 dark:bg-black/20 flex flex-col justify-end"
          isDismissable
        >
          <ReactAriaModal className="px-2 w-full border-t border-gray-700 bg-gray-950">
            <div className="flex flex-col items-stretch border-x border-gray-700">
              <UserInput />
              <SeedInput />
              <ResetButton />
            </div>
          </ReactAriaModal>
        </ModalOverlay>
      </DialogTrigger>
    </div>
  )
}
