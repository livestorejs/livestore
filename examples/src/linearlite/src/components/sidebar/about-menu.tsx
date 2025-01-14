import { Icon } from '@/components/icons'
import { AboutModal } from '@/components/sidebar/about-modal'
import { ChevronDownIcon } from '@heroicons/react/16/solid'
import React from 'react'
import { Button, Header, Menu, MenuItem, MenuSection, MenuTrigger, Popover, Separator } from 'react-aria-components'

export const AboutMenu = () => {
  const [showAboutModal, setShowAboutModal] = React.useState(false)

  return (
    <>
      <MenuTrigger>
        <Button
          aria-label="Menu"
          className="flex items-center text-lg font-bold px-2 h-8 leading-none hover:bg-gray-100 rounded-lg focus:outline-none focus:bg-gray-100"
        >
          <Icon name="linearlite" className="size-5 text-orange-500 mr-2" />
          <span>LinearLite</span>
          <ChevronDownIcon className="size-4 ml-1" />
        </Button>
        <Popover className="w-56 ml-1 bg-white rounded-lg shadow-md border border-gray-200 text-sm leading-none">
          <Menu className="focus:outline-none">
            <MenuSection key="linearlite" className="p-2">
              <Header className="p-2 text-2xs uppercase font-bold tracking-wide text-gray-400">LinearLite</Header>
              <MenuItem
                onAction={() => setShowAboutModal(true)}
                className="p-2 rounded-md hover:bg-gray-100 focus:outline-none focus:bg-gray-100 cursor-pointer"
              >
                About
              </MenuItem>
            </MenuSection>
            <Separator className="w-full h-px bg-gray-200" />
            <MenuSection key="livestore" className="p-2">
              <Header className="p-2 text-2xs uppercase font-bold tracking-wide text-gray-400">LiveStore</Header>
              <MenuItem className="p-2 rounded-md hover:bg-gray-100 focus:outline-none focus:bg-gray-100 cursor-pointer">
                About
              </MenuItem>
              <MenuItem className="p-2 rounded-md hover:bg-gray-100 focus:outline-none focus:bg-gray-100 cursor-pointer">
                Documentation
              </MenuItem>
              <MenuItem className="p-2 rounded-md hover:bg-gray-100 focus:outline-none focus:bg-gray-100 cursor-pointer">
                GitHub
              </MenuItem>
            </MenuSection>
          </Menu>
        </Popover>
      </MenuTrigger>
      <AboutModal show={showAboutModal} setShow={setShowAboutModal} />
    </>
  )
}
