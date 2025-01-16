import { NewIssueModalContext } from '@/app/provider'
import { Modal } from '@/components/common/modal'
import { PriorityMenu } from '@/components/common/priority-menu'
import { StatusMenu } from '@/components/common/status-menu'
import { mutations, tables } from '@/lib/livestore/schema'
import { Priority } from '@/types/priority'
import { Status } from '@/types/status'
import { useStore } from '@livestore/react'
import { generateKeyBetween } from 'fractional-indexing'
import { nanoid } from 'nanoid'
import React from 'react'
import { Button } from 'react-aria-components'
import { DescriptionInput } from './description-input'
import { TitleInput } from './title-input'

export const NewIssueModal = () => {
  const { showNewIssueModal, setShowNewIssueModal } = React.useContext(NewIssueModalContext)!
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [status, setStatus] = React.useState<Status>('backlog')
  const [priority, setPriority] = React.useState<Priority>('none')
  const { store } = useStore()

  const createIssue = () => {
    if (!title) return
    const date = Date.now()
    const lastIssueKanbanorder = store.query(
      tables.issue.query
        .select('kanbanorder', { pluck: true })
        .orderBy('kanbanorder', 'desc')
        .first({ fallback: () => 'a0' }),
    )
    const kanbanorder = generateKeyBetween(lastIssueKanbanorder, null)
    store.mutate(
      mutations.createIssueWithDescription({
        id: nanoid(10),
        title,
        priority,
        status,
        modified: date,
        created: date,
        creator: 'User',
        kanbanorder,
        description,
      }),
    )
    setShowNewIssueModal(false)
  }

  React.useEffect(() => {
    setTitle('')
    setDescription('')
    setStatus('backlog')
    setPriority('none')
  }, [showNewIssueModal])

  return (
    <Modal show={!!showNewIssueModal} setShow={setShowNewIssueModal}>
      <div className="p-2">
        <h2 className="px-2 py-3 leading-none text-2xs uppercase font-medium tracking-wide text-gray-400">New issue</h2>
        <TitleInput title={title} setTitle={setTitle} className="focus:!bg-transparent" autoFocus />
        <DescriptionInput
          description={description}
          setDescription={setDescription}
          className="focus:!bg-transparent -mt-2"
        />
        <div className="mt-2 flex gap-px w-full">
          <StatusMenu showLabel status={status} onStatusChange={setStatus} />
          <PriorityMenu showLabel priority={priority} onPriorityChange={setPriority} />
          <Button
            onPress={createIssue}
            aria-label="Create issue"
            className="ml-auto bg-indigo-500 rounded-lg text-white text-sm px-4 hover:bg-indigo-400 focus:outline-none focus:bg-indigo-400"
          >
            Create issue
          </Button>
        </div>
      </div>
    </Modal>
  )
}
