import { Issue } from '@/lib/livestore/schema'
import type { CSSProperties } from 'react'
import React, { memo } from 'react'
import { DragPreview, useDrag } from 'react-aria'
import { Card } from './card'

export const Draggable = memo(({ issue, style }: { issue: Issue; style: CSSProperties }) => {
  const preview = React.useRef(null)
  let { dragProps, isDragging } = useDrag({
    preview,
    getItems: () => [{ 'text/plain': issue.id.toString() }],
  })

  return (
    <div key={issue.id} id={issue.id.toString()} className="relative px-2 pb-2" style={style}>
      <div {...dragProps}>
        <Card issue={issue} />
        {isDragging && (
          <div className="absolute inset-0 bg-neutral-50 p-3 pt-1">
            <div className="w-full h-full border border-neutral-200/50 rounded-md" />
          </div>
        )}
        <DragPreview ref={preview}>
          {() => (
            <div className="px-2 w-[254px] lg:w-[318px]">
              <Card issue={issue} />
            </div>
          )}
        </DragPreview>
      </div>
    </div>
  )
})
