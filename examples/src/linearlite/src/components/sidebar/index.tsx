import { AboutMenu } from '@/components/sidebar/about-menu'
import { useFilterState } from '@/lib/livestore/queries'
import { Bars4Icon, ViewColumnsIcon } from '@heroicons/react/24/outline'
import React from 'react'
import { Link } from 'react-router-dom'
import { BacklogIcon } from '../icons/backlog'
import { CanceledIcon } from '../icons/canceled'
import { DoneIcon } from '../icons/done'
import { InProgressIcon } from '../icons/in-progress'
import { TodoIcon } from '../icons/todo'
import { ToolbarButton } from '../toolbar/toolbar-button'
import { NewIssueButton } from './new-issue-button'
import { SearchButton } from './search-button'
import { ThemeButton } from './theme-button'

export const Sidebar = ({ className }: { className?: string }) => {
  const [filterState, setFilterState] = useFilterState()

  const navItems = [
    {
      title: 'List view',
      icon: Bars4Icon,
      href: '/',
      onClick: () => setFilterState((state) => ({ ...state, status: undefined })),
    },
    {
      title: 'Backlog',
      icon: BacklogIcon,
      href: '/?status=backlog',
      onClick: () => setFilterState((state) => ({ ...state, status: ['backlog'] })),
      inset: true,
    },
    {
      title: 'Todo',
      icon: TodoIcon,
      href: '/?status=todo',
      onClick: () => setFilterState((state) => ({ ...state, status: ['todo'] })),
      inset: true,
    },
    {
      title: 'In Progress',
      icon: InProgressIcon,
      href: '/?status=in_progress',
      onClick: () => setFilterState((state) => ({ ...state, status: ['in_progress'] })),
      inset: true,
    },
    {
      title: 'Done',
      icon: DoneIcon,
      href: '/?status=done',
      onClick: () => setFilterState((state) => ({ ...state, status: ['done'] })),
      inset: true,
    },
    {
      title: 'Canceled',
      icon: CanceledIcon,
      href: '/?status=canceled',
      onClick: () => setFilterState((state) => ({ ...state, status: ['canceled'] })),
      inset: true,
    },
    {
      title: 'Board view',
      icon: ViewColumnsIcon,
      href: '/board',
      onClick: () => setFilterState((state) => ({ ...state, status: undefined })),
    },
  ]

  return (
    <aside
      className={`bg-white dark:bg-gray-900 w-64 shrink-0 overflow-y-auto flex flex-col justify-between p-2 pt-4 ${className}`}
    >
      <div>
        <div className="flex items-center justify-between pr-2">
          <AboutMenu />
          <div className="flex items-center gap-2">
            <SearchButton />
            <NewIssueButton />
          </div>
        </div>
        <h2 className="p-2 pt-0 leading-none text-2xs uppercase font-medium tracking-wide text-gray-400 mt-8">
          Issues
        </h2>
        <nav className="text-sm leading-none space-y-px">
          {navItems.map(({ title, icon: Icon, href, onClick, inset }, index) => (
            <Link
              key={index}
              to={href}
              onClick={onClick}
              className="flex items-center gap-2 px-2 h-8 rounded-md focus:outline-none dark:hover:bg-gray-800 dark:focus:bg-gray-800 hover:bg-gray-100 focus:bg-gray-100"
            >
              <Icon className={`${inset ? 'size-3 ml-6 text-gray-400' : 'size-4'}`} />
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
