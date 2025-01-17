import { Status } from '@/types/status'
import React from 'react'

interface MenuContextInterface {
  showMenu: boolean
  setShowMenu: (show: boolean) => void
}
interface NewIssueModalContextInterface {
  showNewIssueModal: Status | boolean
  setShowNewIssueModal: (status: Status | boolean) => void
}

export const MenuContext = React.createContext(null as MenuContextInterface | null)
export const NewIssueModalContext = React.createContext(null as NewIssueModalContextInterface | null)
