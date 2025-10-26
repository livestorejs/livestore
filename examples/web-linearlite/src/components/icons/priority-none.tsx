export const PriorityNoneIcon = ({ className }: { className?: string }) => {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`fill-current ${className}`}
      aria-hidden="true"
    >
      <rect x="1.5" y="7.25" width="3" height="1.5" rx="0.5" />
      <rect x="6.5" y="7.25" width="3" height="1.5" rx="0.5" />
      <rect x="11.5" y="7.25" width="3" height="1.5" rx="0.5" />
    </svg>
  )
}
