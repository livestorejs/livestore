import { FI } from '@livestore/fractional-index'
import { casesHandled } from '@livestore/utils'
import * as itsFine from 'its-fine'
import React from 'react'
import ReactDOM from 'react-dom/client'

import type { LiveQuery } from '../../reactiveQueries/base-class.js'
import { computed } from '../../reactiveQueries/js.js'
import type { Store } from '../../store.js'
import { LiveStoreContext, useStore } from '../LiveStoreContext.js'
import { useQuery } from '../useQuery.js'

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

export const DiffableList_ = <TItem,>({
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
  const { store } = useStore()

  const renderListEl = React.useCallback(
    (parentEl: HTMLElement, index: number, item$: LiveQuery<TItem>) => {
      const root = ReactDOM.createRoot(parentEl)
      root.render(
        // <ContextBridge>
        <LiveStoreContext.Provider value={{ store }}>
          <ItemWrapper item$={item$} renderItem={renderItem} opts={{ index, isInitialListRender: !hasMounted }} />
        </LiveStoreContext.Provider>,
        // </ContextBridge>,
      )

      return root
    },
    [hasMounted, renderItem, store],
  )

  React.useLayoutEffect(() => {
    if (ref.current === null) {
      throw new Error('ref.current is null')
    }

    const keys = keys$.run()

    for (let index = 0; index < keys.length; index++) {
      const parentEl = document.createElement('div')
      ref.current!.append(parentEl)
      const item$ = computed((get) => get(items$)[index]!) as LiveQuery<TItem>
      const root = renderListEl(parentEl, index, item$)
      elsRef.current.push({ el: parentEl, item$, root, id: keys[index]! })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => () => keys$.destroy(), [keys$])

  React.useEffect(() => {
    // const keys = keys$.run()

    return keys$.subscribe((keys) => {
      const prevKeys = elsRef.current.map((el) => el.id)

      let arrayIsEqual = true
      for (let i = 0; i < keys.length; i++) {
        if (keys[i] !== prevKeys[i]) {
          arrayIsEqual = false
          break
        }
      }
      if (arrayIsEqual) return

      const previousAgg = FI.aggregateMake(prevKeys, FI.fractionalIndexImplNumber)
      const { newEvents } = FI.getNewEvents(previousAgg, keys, FI.fractionalIndexImplNumber)

      console.log('newEvents', newEvents)

      for (const event of newEvents) {
        switch (event.op) {
          case 'remove': {
            const { index } = event
            const el = elsRef.current[index]!
            el.root.unmount()
            el.el.remove()
            el.item$.destroy()
            elsRef.current.splice(index, 1)
            break
          }
          case 'add': {
            const { index } = event
            const parentEl = document.createElement('div')
            ref.current!.append(parentEl)
            const item$ = computed((get) => get(items$)[index]!) as LiveQuery<TItem>
            const root = renderListEl(parentEl, index, item$)
            elsRef.current.splice(index, 0, { el: parentEl, item$, root, id: keys[index]! })
            break
          }
          case 'move': {
            // const { newIndex, previousIndex } = event

            // const el = elsRef.current[previousIndex]!
            // const item$ = el.item$
            // const root = el.root
            // const elEl = el.el

            // elsRef.current.splice(previousIndex, 1)
            // elsRef.current.splice(newIndex, 0, { el: elEl, item$, root })

            // ref.current!.insertBefore(elEl, elsRef.current[newIndex + 1]?.el)

            // // move dom element

            break
          }
          default: {
            casesHandled(event)
          }
        }
      }
    })

    // for (let index = 0; index < keys.length; index++) {
    //   if (prevKeys[index] === keys[index]) continue

    // // check if `keys[index]` === `prevKeys[index + 1]`
    // // which probably means that
    // if (keys[index] === prevKeys[index + 1]) {
    // 	// sp
    // }

    // prevKeys[index] = keys[index] as any
    // }

    // TODO in the future use a more efficient diffing algorithm that re-uses elements more optimally
    // right now we're only looking one step ahead

    // reconcile until `keys` and `prevKeys` are equal

    // prevKeys = keys
  }, [items$, keys$, renderListEl])

  return <>{container}</>
}

export const DiffableList2 = <TItem,>({
  items$,
  renderContainer,
  renderItem,
  getKey,
}: Props<TItem>): React.ReactNode => (
  // <itsFine.FiberProvider>
  <DiffableList_ items$={items$} renderContainer={renderContainer} renderItem={renderItem} getKey={getKey} />
  // </itsFine.FiberProvider>
)

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
