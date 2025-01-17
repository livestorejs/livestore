import { MenuContext } from '@/app/contexts'
import { Sidebar } from '@/components/layout/sidebar'
import { useFrontendState } from '@/lib/livestore/queries'
import React from 'react'
import { ModalOverlay, Modal as ReactAriaModal } from 'react-aria-components'

export const MobileMenu = () => {
  const { showMenu, setShowMenu } = React.useContext(MenuContext)!
  const [frontendState] = useFrontendState()

  return (
    <ModalOverlay
      isOpen={showMenu}
      onOpenChange={setShowMenu}
      className={`fixed inset-0 bg-black/10 dark:bg-black/20 flex items-stretch ${frontendState.showToolbar ? 'bottom-12' : ''}`}
      isDismissable
    >
      <ReactAriaModal className="border-r border-gray-200 dark:border-gray-700">
        <Sidebar className="h-full" />
      </ReactAriaModal>
    </ModalOverlay>
  )
}
