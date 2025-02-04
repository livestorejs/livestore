import { NewIssueModalContext } from '@/app/contexts'
import { Modal } from '@/components/common/modal'
import { PriorityMenu } from '@/components/common/priority-menu'
import { StatusMenu } from '@/components/common/status-menu'
import { DescriptionInput } from '@/components/layout/issue/description-input'
import { TitleInput } from '@/components/layout/issue/title-input'
import { highestIssueId$, useFrontendState } from '@/lib/livestore/queries'
import { mutations, tables } from '@/lib/livestore/schema'
import { Priority } from '@/types/priority'
import { Status } from '@/types/status'
import { useStore } from '@livestore/react'
import { generateKeyBetween } from 'fractional-indexing'
import React from 'react'
import { Button } from 'react-aria-components'

export const NewIssueModal = () => {
  const [frontendState] = useFrontendState()
  const { newIssueModalStatus, setNewIssueModalStatus } = React.useContext(NewIssueModalContext)!
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [priority, setPriority] = React.useState<Priority>(0)
  const { store } = useStore()

  const closeModal = () => {
    setTitle('')
    setDescription('')
    setPriority(0)
    setNewIssueModalStatus(false)
  }

  const createIssue = () => {
    if (!title) return
    const date = Date.now()
    const highestIssueId = store.query(highestIssueId$)[0]?.id ?? 0
    const highestKanbanOrder = store.query(
      tables.issue.query
        .select('kanbanorder', { pluck: true })
        .where({ status: newIssueModalStatus === false ? 0 : (newIssueModalStatus as Status) })
        .orderBy('kanbanorder', 'desc')
        .first({ fallback: () => 'a1' }),
    )
    const kanbanorder = generateKeyBetween(highestKanbanOrder, null)
    store.mutate(
      mutations.createIssueWithDescription({
        id: highestIssueId + 1,
        title,
        priority,
        status: newIssueModalStatus as Status,
        modified: date,
        created: date,
        creator: frontendState.user,
        kanbanorder,
        description,
      }),
    )
    closeModal()
  }

  return (
    <Modal show={newIssueModalStatus !== false} setShow={closeModal}>
      <div className="p-2">
        <h2 className="px-2 py-3 leading-none text-2xs uppercase font-medium tracking-wide text-neutral-400">
          New issue
        </h2>
        <TitleInput title={title} setTitle={setTitle} className="focus:!bg-transparent" autoFocus />
        <DescriptionInput
          description={description}
          setDescription={setDescription}
          className="focus:!bg-transparent -mt-2"
        />
        <div className="mt-2 flex gap-px w-full">
          <StatusMenu
            showLabel
            status={newIssueModalStatus === false ? 0 : (newIssueModalStatus as Status)}
            onStatusChange={setNewIssueModalStatus}
          />
          <PriorityMenu showLabel priority={priority} onPriorityChange={setPriority} />
          <Button
            onPress={createIssue}
            aria-label="Create issue"
            className="ml-auto bg-orange-500 rounded-lg text-white text-sm px-4 hover:bg-orange-400 focus:outline-none focus:bg-orange-400"
          >
            Create issue
          </Button>
        </div>
      </div>
    </Modal>
  )
}
