import Editor from '@/components/common/editor'
import { useFrontendState } from '@/lib/livestore/queries'
import { mutations } from '@/lib/livestore/schema'
import { ArrowUpIcon } from '@heroicons/react/20/solid'
import { useStore } from '@livestore/react'
import { nanoid } from 'nanoid'
import React from 'react'
import { useKeyboard } from 'react-aria'
import { Button } from 'react-aria-components'

export const CommentInput = ({ issueId, className }: { issueId: string; className?: string }) => {
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
    store.mutate(
      mutations.createComment({
        id: nanoid(),
        body: commentDraft,
        issueId: issueId,
        created: Date.now(),
        creator: frontendState.user,
      }),
    )
    setCommentDraft('')
  }

  return (
    <div className={`bg-white rounded-lg border border-gray-200 shadow ${className}`} {...keyboardProps}>
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
        className="size-7 rounded-full text-gray-600 hover:text-gray-800 focus:text-gray-800 bg-white hover:bg-gray-100 focus:outline-none focus:bg-gray-100 shadow border border-gray-200 flex items-center justify-center ml-auto mr-4 mb-4"
      >
        <ArrowUpIcon className="size-4" />
      </Button>
    </div>
  )
}
