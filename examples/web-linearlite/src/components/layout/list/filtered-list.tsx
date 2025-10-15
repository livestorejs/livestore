import AutoSizer from 'react-virtualized-auto-sizer'
import { FixedSizeList } from 'react-window'
import { useDebouncedScrollState } from '../../../livestore/queries.ts'
import { VirtualRow } from './virtual-row.tsx'

export const FilteredList = ({ filteredIssueIds }: { filteredIssueIds: readonly number[] }) => {
  const [scrollState, setScrollState] = useDebouncedScrollState('filtered-list')

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
            onScroll={(e) => setScrollState({ list: e.scrollOffset })}
            initialScrollOffset={scrollState.list ?? 0}
          >
            {VirtualRow}
          </FixedSizeList>
        )}
      </AutoSizer>
    </div>
  )
}
