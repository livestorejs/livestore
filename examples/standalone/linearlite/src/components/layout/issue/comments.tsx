import { Avatar } from '@/components/common/avatar'
import { tables } from '@/lib/livestore/schema'
import { formatDate } from '@/utils/format-date'
import { queryDb } from '@livestore/livestore'
import { useScopedQuery } from '@livestore/react'
import React from 'react'
import ReactMarkdown from 'react-markdown'

export const Comments = ({ issueId }: { issueId: number }) => {
  const comments = useScopedQuery(
    () => queryDb(tables.comment.query.where('issueId', issueId).orderBy('created', 'desc')),
    [issueId],
  )

  return (
    <ul className="mt-4 flex flex-col gap-4">
      {comments.map(({ id, body, creator, created }) => (
        <li
          key={id}
          className="bg-white dark:bg-gray-800 border border-transparent dark:border-gray-700/50 rounded-lg shadow p-4"
        >
          <div className="flex items-center -ml-0.5 -mt-0.5 mb-2 text-sm">
            <Avatar name={creator} />
            <div className="font-medium ml-2.5 mr-2">{creator}</div>
            {/* TODO: make this a relative date */}
            <div className="text-gray-500 dark:text-gray-400">{formatDate(new Date(created))}</div>
          </div>
          <ReactMarkdown className="text-gray-600 dark:text-gray-200 dark:prose-strong:text-gray-200 prose-sm prose-strong:text-gray-600 prose-p:my-2 prose-ol:my-2 prose-ul:my-2 prose-pre:my-2 font-normal -mb-2">
            {body}
          </ReactMarkdown>
        </li>
      ))}
    </ul>
  )
}
