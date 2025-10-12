import { Bars4Icon, ViewColumnsIcon } from '@heroicons/react/24/outline'
import { Link } from '@tanstack/react-router'
import React from 'react'
import { MenuContext } from '../../../app/contexts.ts'
import { AboutMenu } from './about-menu.tsx'
import { NewIssueButton } from './new-issue-button.tsx'
import { SearchButton } from './search-button.tsx'
import { ThemeButton } from './theme-button.tsx'
import { ToolbarButton } from '../toolbar/toolbar-button.tsx'
import { useFilterState } from '../../../livestore/queries.ts'

export const Sidebar = ({ className }: { className?: string }) => {
  const [, setFilterState] = useFilterState()
  const { setShowMenu } = React.useContext(MenuContext)!

  const navItems = [
    {
      title: 'List view',
      icon: Bars4Icon,
      to: '/',
      onClick: () => setFilterState({ status: null }),
    },
    {
      title: 'Board view',
      icon: ViewColumnsIcon,
      to: '/board',
      onClick: () => setFilterState({ status: null }),
    },
  ]

  return (
    <aside
      className={`bg-white dark:bg-neutral-900 w-64 shrink-0 overflow-y-auto flex flex-col justify-between p-2 pt-4 ${className}`}
    >
      <div>
        <div className="flex items-center justify-between pr-2">
          <AboutMenu />
          <div className="flex items-center gap-2">
            <SearchButton />
            <NewIssueButton />
          </div>
        </div>
        <h2 className="p-2 pt-0 leading-none text-2xs uppercase font-medium tracking-wide text-neutral-400 mt-8">
          Issues
        </h2>
        <nav className="text-sm leading-none space-y-px">
          {navItems.map(({ title, icon: Icon, to, onClick }) => (
            <Link
              key={to}
              to={to}
              search={(prev) => ({ ...prev, issueId: undefined })}
              onClick={() => {
                onClick()
                setShowMenu(false)
              }}
              className="flex items-center gap-2 px-2 h-8 rounded-md focus:outline-none dark:hover:bg-neutral-800 dark:focus:bg-neutral-800 hover:bg-neutral-100 focus:bg-neutral-100"
            >
              <Icon className="size-4" />
              <span>{title}</span>
            </Link>
          ))}
        </nav>
      </div>
      <div className="p-2 flex items-center gap-2">
        <ToolbarButton />
        <ThemeButton />
      </div>
    </aside>
  )
}
