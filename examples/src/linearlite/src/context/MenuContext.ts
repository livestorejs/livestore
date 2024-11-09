import React from 'react'

interface MenuContextInterface {
  showMenu: boolean
  setShowMenu: (show: boolean) => void
}

export const MenuContext = React.createContext(null as MenuContextInterface | null)
