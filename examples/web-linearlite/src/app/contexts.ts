import React from 'react'

interface MenuContextInterface {
  showMenu: boolean
  setShowMenu: (show: boolean) => void
}

type IssueStatus = 0 | 1 | 2 | 3 | 4

interface NewIssueModalContextInterface {
  newIssueModalStatus: IssueStatus | boolean
  setNewIssueModalStatus: (status: IssueStatus | false) => void
}

export const MenuContext = React.createContext(null as MenuContextInterface | null)
export const NewIssueModalContext = React.createContext(null as NewIssueModalContextInterface | null)
