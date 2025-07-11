import { Bars4Icon, ViewColumnsIcon } from '@heroicons/react/24/outline'
import React from 'react'
import { Link } from 'react-router-dom'
import { MenuContext } from '@/app/contexts'
import { AboutMenu } from '@/components/layout/sidebar/about-menu'
import { NewIssueButton } from '@/components/layout/sidebar/new-issue-button'
import { SearchButton } from '@/components/layout/sidebar/search-button'
import { ThemeButton } from '@/components/layout/sidebar/theme-button'
import { ToolbarButton } from '@/components/layout/toolbar/toolbar-button'
import { useFilterState } from '@/lib/livestore/queries'

export const Sidebar = ({ className }: { className?: string }) => {
  const [, setFilterState] = useFilterState()
  const { setShowMenu } = React.useContext(MenuContext)!

  const navItems = [
    {
      title: 'List view',
      icon: Bars4Icon,
      href: '/',
      onClick: () => setFilterState({ status: null }),
    },
    {
      title: 'Board view',
      icon: ViewColumnsIcon,
      href: '/board',
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
          {navItems.map(({ title, icon: Icon, href, onClick }) => (
            <Link
              key={href}
              to={href}
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
