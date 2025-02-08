import { CodeBracketIcon } from '@heroicons/react/16/solid'
import React from 'react'

export const DevtoolsButton = ({ className }: { className?: string }) => {
  return (
    <div className={`lg:h-full flex items-center ${className}`}>
      <a
        aria-label="Download database"
        href="/_devtools.html"
        target="_blank"
        className="h-6 px-1.5 flex items-center gap-1 bg-orange-500 text-white rounded hover:bg-orange-400 focus:outline-none focus:bg-orange-400"
      >
        <CodeBracketIcon className="size-3.5 shrink-0" />
        <span>Devtools</span>
      </a>
    </div>
  )
}
