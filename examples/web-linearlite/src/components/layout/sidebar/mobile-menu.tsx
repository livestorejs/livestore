import React from 'react'
import { ModalOverlay, Modal as ReactAriaModal } from 'react-aria-components'
import { MenuContext } from '../../../app/contexts.ts'
import { Sidebar } from './index.tsx'
import { useFrontendState } from '../../../livestore/queries.ts'

export const MobileMenu = () => {
  const { showMenu, setShowMenu } = React.useContext(MenuContext)!
  const [frontendState] = useFrontendState()

  return (
    <ModalOverlay
      isOpen={showMenu}
      onOpenChange={setShowMenu}
      className={`fixed inset-0 bg-black/10 dark:bg-black/20 flex items-stretch ${frontendState.showToolbar ? 'bottom-10' : ''}`}
      isDismissable
    >
      <ReactAriaModal className="border-r border-neutral-200 dark:border-neutral-700">
        <Sidebar className="h-full" />
      </ReactAriaModal>
    </ModalOverlay>
  )
}
