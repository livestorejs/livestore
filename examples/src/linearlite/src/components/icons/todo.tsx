import React from 'react'

export const TodoIcon = ({ className }: { className?: string }) => {
  return (
    <svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" className={`stroke-current ${className}`}>
      <circle
        cx="7"
        cy="7"
        r="6"
        fill="none"
        stroke-width="2"
        stroke-dasharray="3.14 0"
        stroke-dashoffset="-0.7"
      ></circle>
      <circle
        cx="7"
        cy="7"
        r="2"
        fill="none"
        stroke-width="4"
        stroke-dasharray="0 100"
        stroke-dashoffset="0"
        transform="rotate(-90 7 7)"
      ></circle>
    </svg>
  )
}
