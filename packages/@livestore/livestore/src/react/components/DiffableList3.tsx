import { FI } from '@livestore/fractional-index'
import { casesHandled } from '@livestore/utils'
import * as million from 'million'
import React from 'react'
import type ReactDOM from 'react-dom/client'

import type { LiveQuery } from '../../reactiveQueries/base-class.js'
import { computed } from '../../reactiveQueries/js.js'
import type { Store } from '../../store.js'
import { LiveStoreContext, useStore } from '../LiveStoreContext.js'
import { useQuery } from '../useQuery.js'

/*

*/

export type Props<TItem> = {
  items$: LiveQuery<ReadonlyArray<TItem>>
  /**
   * @example
   * ```tsx
   * renderContainer={(children) => <ul>{children}</ul>}
   * ```
   */
  renderContainer: (ref: React.LegacyRef<any>) => React.ReactNode
  // TODO refactor render-flag to allow for transition animations on add/remove
  renderItem: (item: TItem, opts: { index: number; isInitialListRender: boolean }) => React.ReactNode
  getKey: (item: TItem, index: number) => string | number
}

export const DiffableList = <TItem,>({
  items$,
  renderContainer,
  renderItem,
  getKey,
}: Props<TItem>): React.ReactNode => {
  const ref = React.useRef<HTMLElement>(null)
  const container = renderContainer(ref)

  const [hasMounted, setHasMounted] = React.useState(false)

  React.useEffect(() => setHasMounted(true), [])

  const keys$ = computed((get) => get(items$).map(getKey))
  type RefEl = {
    id: string | number
    el: HTMLElement
    item$: LiveQuery<TItem>
    root: ReactDOM.Root
  }
  const elsRef = React.useRef<RefEl[]>([])

  // const ContextBridge = itsFine.useContextBridge()
  // const { store } = useStore()

  // const renderListEl = React.useCallback(
  //   (parentEl: HTMLElement, index: number, item$: LiveQuery<TItem>) => {
  //     const root = ReactDOM.createRoot(parentEl)
  //     root.render(
  //       // <ContextBridge>
  //       <LiveStoreContext.Provider value={{ store }}>
  //         <ItemWrapper item$={item$} renderItem={renderItem} opts={{ index, isInitialListRender: !hasMounted }} />
  //       </LiveStoreContext.Provider>,
  //       // </ContextBridge>,
  //     )

  //     return root
  //   },
  //   [hasMounted, renderItem, store],
  // )

  React.useLayoutEffect(() => {
    if (ref.current === null) {
      throw new Error('ref.current is null')
    }

    const keys = keys$.run()

    const queries$ = keys.map((_key, index) => computed((get) => get(items$)[index]!)) as LiveQuery<TItem>[]

    // const list = million.mapArray(
    //   queries$.map((item$, index) =>
    //     ItemWrapperBlock({
    //       item$,
    //       opts: { index, isInitialListRender: !hasMounted },
    //       renderItem,
    //     }),
    //   ),
    // )

    // million.mount(list, ref.current)

    // const keys = keys$.run()

    // for (let index = 0; index < keys.length; index++) {
    //   const parentEl = document.createElement('div')
    //   ref.current!.append(parentEl)
    //   const item$ = computed((get) => get(items$)[index]!) as LiveQuery<TItem>
    //   const root = renderListEl(parentEl, index, item$)
    //   elsRef.current.push({ el: parentEl, item$, root, id: keys[index]! })
    // }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => () => keys$.destroy(), [keys$])

  return <>{container}</>
}

const ItemWrapper = <TItem,>({
  item$,
  opts,
  renderItem,
}: {
  item$: LiveQuery<TItem>
  opts: { index: number; isInitialListRender: boolean }
  renderItem: (item: TItem, opts: { index: number; isInitialListRender: boolean }) => React.ReactNode
}) => {
  const item = useQuery(item$)

  return <>{renderItem(item, opts)}</>
}

const ItemWrapperBlock = million.block(ItemWrapper as any)
