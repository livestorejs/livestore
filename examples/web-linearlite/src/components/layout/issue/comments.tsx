import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react'
import ReactMarkdown from 'react-markdown'
import { Avatar } from '@/components/common/avatar'
import { tables } from '@/lib/livestore/schema'
import { formatDate } from '@/utils/format-date'

export const Comments = ({ issueId }: { issueId: number }) => {
  const { store } = useStore()
  const comments = store.useQuery(
    queryDb(tables.comment.where('issueId', issueId).orderBy('created', 'desc'), { deps: [issueId] }),
  )

  return (
    <ul className="mt-4 flex flex-col gap-4">
      {comments.map(({ id, body, creator, created }) => (
        <li
          key={id}
          className="bg-white dark:bg-neutral-800 border border-transparent dark:border-neutral-700/50 rounded-lg shadow p-4"
        >
          <div className="flex items-center -ml-0.5 -mt-0.5 mb-2 text-sm">
            <Avatar name={creator} />
            <div className="font-medium ml-2.5 mr-2">{creator}</div>
            {/* TODO: make this a relative date */}
            <div className="text-neutral-500 dark:text-neutral-400">{formatDate(new Date(created))}</div>
          </div>
          <div className="text-neutral-600 dark:text-neutral-200 dark:prose-strong:text-neutral-200 prose-sm prose-strong:text-neutral-600 prose-p:my-2 prose-ol:my-2 prose-ul:my-2 prose-pre:my-2 font-normal -mb-2">
            <ReactMarkdown>{body}</ReactMarkdown>
          </div>
        </li>
      ))}
    </ul>
  )
}
