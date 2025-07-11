export const DoneIcon = ({ className }: { className?: string }) => {
  return (
    <svg
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`fill-current ${className}`}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M7 0C3.13401 0 0 3.13401 0 7C0 10.866 3.13401 14 7 14C10.866 14 14 10.866 14 7C14 3.13401 10.866 0 7 0ZM10.951 5.45104C11.283 5.11909 11.283 4.58091 10.951 4.24896C10.6191 3.91701 10.0809 3.91701 9.74896 4.24896L5.35 8.64792L3.95104 7.24896C3.61909 6.91701 3.0809 6.91701 2.74896 7.24896C2.41701 7.5809 2.41701 8.11909 2.74896 8.45104L4.74896 10.451C5.0809 10.783 5.61909 10.783 5.95104 10.451L10.951 5.45104Z"
      />
    </svg>
  )
}
