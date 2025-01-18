import { VirtualRow } from '@/components/layout/list/virtual-row'
import React from 'react'
import AutoSizer from 'react-virtualized-auto-sizer'
import { FixedSizeList } from 'react-window'

export const FilteredList = ({ filteredIssueIds }: { filteredIssueIds: readonly number[] }) => {
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
          >
            {VirtualRow}
          </FixedSizeList>
        )}
      </AutoSizer>
    </div>
  )
}
