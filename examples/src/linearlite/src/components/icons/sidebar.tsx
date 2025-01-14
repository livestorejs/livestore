import React from 'react'

export const SidebarIcon = ({ className }: { className?: string }) => {
  return (
    <svg viewBox="0 0 320 320" fill="none" xmlns="http://www.w3.org/2000/svg" className={`fill-current ${className}`}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M225 54H94C71.9086 54 54 71.9086 54 94V225C54 247.091 71.9086 265 94 265H225C247.091 265 265 247.091 265 225V94C265 71.9086 247.091 54 225 54ZM94 30C58.6538 30 30 58.6538 30 94V225C30 260.346 58.6538 289 94 289H225C260.346 289 289 260.346 289 225V94C289 58.6538 260.346 30 225 30H94Z"
      />
      <path d="M111 49H135V270H111V49Z" />
    </svg>
  )
}
