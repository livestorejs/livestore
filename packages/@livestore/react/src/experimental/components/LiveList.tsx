import type { LiveQueryDef } from '@livestore/livestore'
import { computed } from '@livestore/livestore'
import React from 'react'

import { useQuery } from '../../useQuery.js'

/*
TODO:
- [ ] Bring back incremental rendering (see https://github.com/livestorejs/livestore/pull/55)
- [ ] Enable exit animations
*/

export type LiveListProps<TItem> = {
  items$: LiveQueryDef<ReadonlyArray<TItem>>
  // TODO refactor render-flag to allow for transition animations on add/remove
  renderItem: (item: TItem, opts: { index: number; isInitialListRender: boolean }) => React.ReactNode
  /** Needs to be unique across all list items */
  getKey: (item: TItem, index: number) => string | number
}

/**
 * This component is a helper component for rendering a list of items for a LiveQuery of an array of items.
 * The idea is that instead of letting React handle the rendering of the items array directly,
 * we derive a item LiveQuery for each item which moves the reactivity to the item level when a single item changes.
 *
 * In the future we want to make this component even more efficient by using incremental rendering (https://github.com/livestorejs/livestore/pull/55)
 * e.g. when an item is added/removed/moved to only re-render the affected DOM nodes.
 */
export const LiveList = <TItem,>({ items$, renderItem, getKey }: LiveListProps<TItem>): React.ReactNode => {
  const [hasMounted, setHasMounted] = React.useState(false)

  React.useEffect(() => setHasMounted(true), [])

  const keys = useQuery(computed((get) => get(items$).map(getKey)))
  const arr = React.useMemo(
    () =>
      keys.map(
        (key) =>
          // TODO figure out a way so that `item$` returns an ordered lookup map to more efficiently find the item by key
          [
            key,
            computed((get) => get(items$).find((item) => getKey(item, 0) === key)!, {
              deps: [key],
            }) as LiveQueryDef<TItem>,
          ] as const,
      ),
    [getKey, items$, keys],
  )

  return (
    <>
      {arr.map(([key, item$], index) => (
        <ItemWrapperMemo
          key={key}
          itemKey={key}
          item$={item$}
          opts={{ isInitialListRender: !hasMounted, index }}
          renderItem={renderItem}
        />
      ))}
    </>
  )
}

const ItemWrapper = <TItem,>({
  item$,
  opts,
  renderItem,
}: {
  itemKey: string | number
  item$: LiveQueryDef<TItem>
  opts: { index: number; isInitialListRender: boolean }
  renderItem: (item: TItem, opts: { index: number; isInitialListRender: boolean }) => React.ReactNode
}) => {
  const item = useQuery(item$)

  return <>{renderItem(item, opts)}</>
}

const ItemWrapperMemo = React.memo(
  ItemWrapper,
  (prev, next) =>
    prev.itemKey === next.itemKey &&
    prev.renderItem === prev.renderItem &&
    prev.opts.index === next.opts.index &&
    prev.opts.isInitialListRender === next.opts.isInitialListRender,
) as typeof ItemWrapper
