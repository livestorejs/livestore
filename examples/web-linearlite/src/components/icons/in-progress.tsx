export const InProgressIcon = ({ className }: { className?: string }) => {
  return (
    <svg
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`stroke-current ${className}`}
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="6" fill="none" strokeWidth="2" strokeDasharray="3.14 0" strokeDashoffset="-0.7" />
      <circle
        cx="7"
        cy="7"
        r="2"
        fill="none"
        strokeWidth="4"
        strokeDasharray="6.2517693806436885 100"
        strokeDashoffset="0"
        transform="rotate(-90 7 7)"
      />
    </svg>
  )
}
