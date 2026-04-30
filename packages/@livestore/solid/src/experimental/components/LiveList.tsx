import type { Accessor, JSX } from 'solid-js'
import * as Solid from 'solid-js'

import type { LiveQueryDef, Store } from '@livestore/livestore'
import { computed } from '@livestore/livestore'

import { useQuery } from '../../useQuery.ts'

/*
TODO:
- [ ] Bring back incremental rendering (see https://github.com/livestorejs/livestore/pull/55)
- [ ] Enable exit animations
*/

export type LiveListProps<TItem> = {
  items$: LiveQueryDef<ReadonlyArray<TItem>>
  // TODO refactor render-flag to allow for transition animations on add/remove
  renderItem: (item: Accessor<TItem>, index: Accessor<number>) => JSX.Element
  /** Needs to be unique across all list items */
  getKey: (item: TItem, index: number) => string | number
  /** The store instance to use for queries */
  store: Store<any, any>
}

/**
 * This component is a helper component for rendering a list of items for a LiveQuery of an array of items.
 * The idea is that instead of letting Solid handle the rendering of the items array directly,
 * we derive a item LiveQuery for each item which moves the reactivity to the item level when a single item changes.
 *
 * In the future we want to make this component even more efficient by using incremental rendering (https://github.com/livestorejs/livestore/pull/55)
 * e.g. when an item is added/removed/moved to only re-render the affected DOM nodes.
 */
export const LiveList = <TItem,>(props: LiveListProps<TItem>): JSX.Element => {
  const [config] = Solid.splitProps(props, ['store'])
  const keys = useQuery(
    () => computed((get) => get(props.items$).map((item, index) => props.getKey(item, index))),
    config,
  )
  return <Solid.For each={keys()}>{(key, index) => <ItemWrapper {...props} key={key} index={index} />}</Solid.For>
}

export const ItemWrapper = <TItem,>(
  props: { key: string | number; index: Accessor<number> } & LiveListProps<TItem>,
) => {
  const [config] = Solid.splitProps(props, ['store'])
  const item = useQuery(
    () =>
      computed((get) => get(props.items$).find((item, index) => props.getKey(item, index) === props.key)!, {
        deps: [props.key],
      }),
    config,
  )
  return <>{props.renderItem(item, props.index)}</>
}
