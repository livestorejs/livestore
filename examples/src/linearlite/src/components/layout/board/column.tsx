import { Icon } from '@/components/icons'
import { NewIssueButton } from '@/components/layout/sidebar/new-issue-button'
import { StatusDetails } from '@/data/status-options'
import { useDebounce } from '@/hooks/useDebounce'
import { filterState$, useFilterState, useScrollState } from '@/lib/livestore/queries'
import { events, tables } from '@/lib/livestore/schema'
import { filterStateToWhere } from '@/lib/livestore/utils'
import { Status } from '@/types/status'
import { queryDb } from '@livestore/livestore'
import * as LiveStoreReact from '@livestore/react'
import { generateKeyBetween } from 'fractional-indexing'
import React from 'react'
import {
  DropIndicator,
  DropPosition,
  DroppableCollectionReorderEvent,
  GridList,
  GridListItem,
  ListLayout,
  Virtualizer,
  isTextDropItem,
  useDragAndDrop,
} from 'react-aria-components'
import AutoSizer from 'react-virtualized-auto-sizer'
import { Card } from './card'

export const Column = ({ status, statusDetails }: { status: Status; statusDetails: StatusDetails }) => {
  // TODO: Hook up scroll state again
  const [scrollState, setScrollState] = useScrollState()
  const onScroll = useDebounce((e) => {}, 100)
  const { store } = LiveStoreReact.useStore()
  const [filterState] = useFilterState()

  const filteredIssues$ = queryDb(
    (get) =>
      tables.issue
        .select()
        .where({ priority: filterStateToWhere(get(filterState$))?.priority, status, deleted: null })
        .orderBy('kanbanorder', 'desc'),
    { label: 'List.visibleIssues', deps: [status] },
  )
  const filteredIssues = store.useQuery(filteredIssues$)

  const getNewCanbanOrder = (targetId: string, dropPosition: DropPosition) => {
    const before = dropPosition !== 'after'
    const targetKanbanOrder = store.query(
      tables.issue
        .select('kanbanorder')
        .where({ id: Number(targetId) })
        .first(),
    )
    const nearestKanbanOrder = store.query(
      tables.issue
        .select('kanbanorder')
        .where({
          status,
          priority: filterState.priority ? { op: 'IN', value: filterState.priority } : undefined,
          kanbanorder: { op: before ? '>' : '<', value: targetKanbanOrder },
        })
        .orderBy('kanbanorder', before ? 'asc' : 'desc')
        .limit(1),
    )[0]
    return generateKeyBetween(
      before ? targetKanbanOrder : nearestKanbanOrder,
      before ? nearestKanbanOrder : targetKanbanOrder,
    )
  }

  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map((key) => ({ 'text/plain': key.toString() })),
    onReorder: (e: DroppableCollectionReorderEvent) => {
      const items = [...e.keys]
      const kanbanorder = getNewCanbanOrder(e.target.key as string, e.target.dropPosition)
      store.commit(events.updateIssueKanbanOrder({ id: Number(items[0]), status, kanbanorder, modified: new Date() }))
    },
    onInsert: async (e) => {
      const items = await Promise.all(
        e.items.filter(isTextDropItem).map(async (item) => JSON.parse(await item.getText('text/plain')).toString()),
      )
      const kanbanorder = getNewCanbanOrder(e.target.key as string, e.target.dropPosition)
      store.commit(events.updateIssueKanbanOrder({ id: Number(items[0]), status, kanbanorder, modified: new Date() }))
    },
    onRootDrop: async (e) => {
      const items = await Promise.all(
        e.items.filter(isTextDropItem).map(async (item) => JSON.parse(await item.getText('text/plain')).toString()),
      )
      const lowestKanbanOrder = store.query(
        tables.issue.select('kanbanorder').where({ status }).orderBy('kanbanorder', 'asc').limit(1),
      )[0]
      const kanbanorder = lowestKanbanOrder ? generateKeyBetween(null, lowestKanbanOrder) : 'a1'
      store.commit(events.updateIssueKanbanOrder({ id: Number(items[0]), status, kanbanorder, modified: new Date() }))
    },
    renderDropIndicator: (target) => {
      return <DropIndicator target={target} className="h-1 mx-3.5 rounded-full bg-orange-500" />
    },
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
      <div className="grow">
        <AutoSizer>
          {({ width, height }: { width: number; height: number }) => (
            <Virtualizer layout={layout}>
              <GridList
                items={filteredIssues}
                aria-label={`Issues with status ${statusDetails.name}`}
                dragAndDropHooks={dragAndDropHooks}
                className="pt-2 overflow-y-auto"
                style={{ width, height }}
              >
                {(issue) => (
                  <GridListItem
                    textValue={issue.id.toString()}
                    aria-label={`Issue ${issue.id}: ${issue.title}`}
                    className="group data-[dragging]:opacity-50 w-full px-2 focus:outline-none"
                  >
                    <Card issue={issue} />
                  </GridListItem>
                )}
              </GridList>
            </Virtualizer>
          )}
        </AutoSizer>
      </div>
    </div>
  )
}
