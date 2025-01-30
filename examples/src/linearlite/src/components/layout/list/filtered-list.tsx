import { VirtualRow } from '@/components/layout/list/virtual-row'
import { useDebounce } from '@/hooks/useDebounce'
import { useScrollState } from '@/lib/livestore/queries'
import React from 'react'
import AutoSizer from 'react-virtualized-auto-sizer'
import { FixedSizeList, ListOnScrollProps } from 'react-window'

export const FilteredList = ({ filteredIssueIds }: { filteredIssueIds: readonly number[] }) => {
  const [scrollState, setScrollState] = useScrollState()
  const onScroll = useDebounce((props: ListOnScrollProps) => {
    setScrollState((scrollState) => ({ ...scrollState, list: props.scrollOffset }))
  }, 100)

  return (
    <div className="grow">
      <AutoSizer>
        {({ height, width }: { width: number; height: number }) => (
          <FixedSizeList
            height={height}
            itemCount={filteredIssueIds.length}
            itemSize={48}
            itemData={filteredIssueIds}
            overscanCount={10}
            width={width}
            onScroll={onScroll}
            initialScrollOffset={scrollState.list ?? 0}
          >
            {VirtualRow}
          </FixedSizeList>
        )}
      </AutoSizer>
    </div>
  )
}
