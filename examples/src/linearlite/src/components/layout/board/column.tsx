import { Icon } from '@/components/icons'
import { NewIssueButton } from '@/components/layout/sidebar/new-issue-button'
import { StatusDetails } from '@/data/status-options'
import { useDebounce } from '@/hooks/useDebounce'
import { filterState$, useScrollState } from '@/lib/livestore/queries'
import { tables } from '@/lib/livestore/schema'
import { filterStateToWhere } from '@/lib/livestore/utils'
import { Status } from '@/types/status'
import { queryDb } from '@livestore/livestore'
import { useQuery } from '@livestore/react'
import React from 'react'
import {
  DropIndicator,
  DroppableCollectionReorderEvent,
  GridList,
  GridListItem,
  UNSTABLE_ListLayout as ListLayout,
  UNSTABLE_Virtualizer as Virtualizer,
  useDragAndDrop,
} from 'react-aria-components'
import { VirtualCard } from './virtual-card'

export const Column = ({ status, statusDetails }: { status: Status; statusDetails: StatusDetails }) => {
  // TODO: Hook up scroll state again
  const [scrollState, setScrollState] = useScrollState()
  const onScroll = useDebounce((e) => {}, 100)

  const filteredIssueIds$ = queryDb(
    (get) =>
      tables.issue.query
        .select('id')
        .where({ priority: filterStateToWhere(get(filterState$))?.priority, status, deleted: null })
        .orderBy('kanbanorder', 'desc'),
    { label: 'List.visibleIssueIds' },
  )
  const filteredIssueIds = useQuery(filteredIssueIds$)

  let { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map((key) => ({ 'text/plain': key.toString() })),
    onReorder: (e: DroppableCollectionReorderEvent) => {
      console.log(e)
      if (e.target.dropPosition === 'before') {
      } else if (e.target.dropPosition === 'after') {
      }
    },
    onInsert: async (e) => {
      if (e.target.dropPosition === 'before') {
      } else if (e.target.dropPosition === 'after') {
      }
    },
    onRootDrop: async (e) => {},
    renderDropIndicator: (target) => {
      return <DropIndicator target={target} className="h-1 mx-1.5 rounded-full bg-orange-500" />
    },
    acceptedDragTypes: ['text/plain'],
    getDropOperation: () => 'move',
  })

  const layout = React.useMemo(
    () =>
      new ListLayout({
        rowHeight: 124,
        dropIndicatorThickness: 15,
      }),
    [],
  )

  return (
    <div className="bg-neutral-50 border border-neutral-100 dark:bg-neutral-800 dark:border-neutral-700/50 rounded-lg w-64 lg:w-80 shrink-0 h-full flex flex-col">
      <div className="flex items-center justify-between p-2 pb-0 pl-4 gap-4">
        <div className="flex items-center gap-2">
          <Icon name={statusDetails.icon} className={`size-3.5 ${statusDetails.style}`} />
          <h3 className="font-medium text-sm">{statusDetails.name}</h3>
        </div>
        <NewIssueButton status={status} />
      </div>
      <div className="grow overflow-y-auto px-2" onScroll={onScroll}>
        <Virtualizer layout={layout}>
          <GridList
            items={filteredIssueIds}
            aria-label={`Issues with status ${statusDetails.name}`}
            dragAndDropHooks={dragAndDropHooks}
            className="pt-2"
          >
            {(row) => (
              <GridListItem
                textValue={row.id.toString()}
                aria-label={`Issue ${row.id}`}
                className="data-[dragging]:opacity-50"
              >
                <VirtualCard issueId={row.id} />
              </GridListItem>
            )}
          </GridList>
        </Virtualizer>
      </div>
    </div>
  )
}
