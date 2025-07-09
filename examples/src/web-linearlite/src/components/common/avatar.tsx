import { getAcronym } from '@/utils/get-acronym'

export const Avatar = ({ name }: { name?: string }) => {
  if (!name) name = 'Me'
  return (
    <div className="size-6 shrink-0 rounded-full flex items-center justify-center bg-neutral-200 dark:bg-neutral-600 text-xs font-medium text-neutral-500 dark:text-neutral-300">
      {getAcronym(name)}
    </div>
  )
}
