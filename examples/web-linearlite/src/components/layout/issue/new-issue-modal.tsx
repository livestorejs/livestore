import { useStore } from '@livestore/react'
import { generateKeyBetween } from 'fractional-indexing'
import React from 'react'
import { Button } from 'react-aria-components'
import { NewIssueModalContext } from '../../../app/contexts.ts'
import { highestIssueId$, useFrontendState } from '../../../livestore/queries.ts'
import { events, tables } from '../../../livestore/schema/index.ts'
import type { Priority } from '../../../types/priority.ts'
import type { Status } from '../../../types/status.ts'
import { Modal } from '../../common/modal.tsx'
import { PriorityMenu } from '../../common/priority-menu.tsx'
import { StatusMenu } from '../../common/status-menu.tsx'
import { DescriptionInput } from './description-input.tsx'
import { TitleInput } from './title-input.tsx'

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
    const date = new Date()
    // TODO make this "merge safe"
    const highestIssueId = store.query(highestIssueId$)
    const highestKanbanOrder = store.query(
      tables.issue
        .select('kanbanorder')
        .where({ status: newIssueModalStatus === false ? 0 : (newIssueModalStatus as Status) })
        .orderBy('kanbanorder', 'desc')
        .first({ behaviour: 'fallback', fallback: () => 'a1' }),
    )
    const kanbanorder = generateKeyBetween(highestKanbanOrder, null)
    store.commit(
      events.createIssueWithDescription({
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
        <TitleInput title={title} setTitle={setTitle} className="focus:!bg-transparent" />
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
