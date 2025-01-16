import React from 'react'

export const Shortcut = ({ keys, className }: { keys: string[]; className?: string }) => {
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {keys.map((key) => (
        <div
          key={key}
          className="text-2xs pt-px text-gray-600 leading-none h-4 min-w-4 flex items-center justify-center px-1 border border-gray-300 rounded uppercase font-mono leading-none"
        >
          {key}
        </div>
      ))}
    </div>
  )
}
