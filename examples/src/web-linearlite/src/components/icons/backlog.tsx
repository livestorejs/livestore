import React from 'react'

export const BacklogIcon = ({ className }: { className?: string }) => {
  return (
    <svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" className={`stroke-current ${className}`}>
      <circle
        cx="7"
        cy="7"
        r="6"
        fill="none"
        strokeWidth="2"
        strokeDasharray="1.4 1.74"
        strokeDashoffset="0.65"
      ></circle>
      <circle
        cx="7"
        cy="7"
        r="2"
        fill="none"
        strokeWidth="4"
        strokeDasharray="0 100"
        strokeDashoffset="0"
        transform="rotate(-90 7 7)"
      ></circle>
    </svg>
  )
}
