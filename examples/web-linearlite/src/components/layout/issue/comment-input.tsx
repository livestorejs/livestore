import { ArrowUpIcon } from '@heroicons/react/20/solid'
import { useStore } from '@livestore/react'
import React from 'react'
import { useKeyboard } from 'react-aria'
import { Button } from 'react-aria-components'
import Editor from '../../common/editor.tsx'
import { useFrontendState } from '../../../livestore/queries.ts'
import { events } from '../../../livestore/schema/index.ts'

export const CommentInput = ({ issueId, className }: { issueId: number; className?: string }) => {
  // TODO move this into LiveStore
  const [commentDraft, setCommentDraft] = React.useState<string>('')
  const [frontendState] = useFrontendState()
  const { store } = useStore()

  const { keyboardProps } = useKeyboard({
    onKeyDown: (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        submitComment()
      }
    },
  })

  const submitComment = () => {
    if (!commentDraft) return
    store.commit(
      events.createComment({
        id: crypto.randomUUID(),
        body: commentDraft,
        issueId: issueId,
        created: new Date(),
        creator: frontendState.user,
      }),
    )
    setCommentDraft('')
  }

  return (
    <div
      className={`bg-white dark:bg-neutral-800 pb-4 rounded-lg shadow dark:shadow-none border border-transparent dark:border-neutral-700/50 ${className}`}
      {...keyboardProps}
    >
      <Editor
        className="px-4 py-1"
        value={commentDraft}
        onChange={(value) => setCommentDraft(value)}
        placeholder="Leave a comment..."
      />
      {/* TODO add tooltip for submit shortcut */}
      <Button
        aria-label="Submit comment"
        onPress={submitComment}
        className="size-7 rounded-full text-neutral-600 dark:text-neutral-200 hover:text-neutral-800 focus:text-neutral-800 dark:hover:text-neutral-100 dark:focus:text-neutral-100 bg-white hover:bg-neutral-100 focus:outline-none focus:bg-neutral-100 shadow border border-neutral-200 dark:border-neutral-600 flex items-center justify-center ml-auto mr-4 dark:bg-neutral-800 dark:hover:bg-neutral-700 dark:focus:bg-neutral-700"
      >
        <ArrowUpIcon className="size-4" />
      </Button>
    </div>
  )
}
