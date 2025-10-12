import { ChevronUpIcon } from '@heroicons/react/16/solid'
import { Button, DialogTrigger, ModalOverlay, Modal as ReactAriaModal } from 'react-aria-components'
import { ResetButton } from './reset-button.tsx'
import { SeedInput } from './seed-input.tsx'
import { ShareButton } from './share-button.tsx'
import { SyncToggle } from './sync-toggle.tsx'
import { UserInput } from './user-input.tsx'

export const MobileMenu = () => {
  return (
    <div className="h-full lg:hidden items-center border-x border-neutral-700 shrink-0 flex">
      <DialogTrigger>
        <Button
          aria-label="Open LiveStore tools"
          className="h-8 border-y border-neutral-700 flex items-center gap-1 pr-2 pl-3 focus:outline-none hover:bg-neutral-800 text-sm text-neutral-400 focus:bg-neutral-800"
        >
          <span>Tools</span>
          <ChevronUpIcon className="size-4" />
        </Button>
        <ModalOverlay
          className="fixed inset-0 bottom-10 bg-black/10 dark:bg-black/20 flex flex-col justify-end"
          isDismissable
        >
          <ReactAriaModal className="px-2 w-full border-t border-neutral-700 bg-neutral-950">
            <div className="flex flex-col items-stretch border-x border-neutral-700">
              <div className="text-sm text-neutral-400 border-b border-neutral-700 px-2 py-4">
                Please use the desktop version to access all LiveStore tools!
              </div>
              <UserInput />
              <SeedInput />
              <ResetButton />
              <ShareButton />
              <SyncToggle />
            </div>
          </ReactAriaModal>
        </ModalOverlay>
      </DialogTrigger>
    </div>
  )
}
