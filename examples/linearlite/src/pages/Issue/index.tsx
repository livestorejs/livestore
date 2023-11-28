import { useNavigate, useParams } from 'react-router-dom'
import { useState, useCallback } from 'react'
import { BsTrash3 as DeleteIcon } from 'react-icons/bs'
import { BsXLg as CloseIcon } from 'react-icons/bs'
import PriorityMenu from '../../components/contextmenu/PriorityMenu'
import StatusMenu from '../../components/contextmenu/StatusMenu'
import PriorityIcon from '../../components/PriorityIcon'
import StatusIcon from '../../components/StatusIcon'
import Avatar from '../../components/Avatar'
import { PriorityDisplay, StatusDisplay } from '../../types/issue'
import Editor from '../../components/editor/Editor'
import DeleteModal from './DeleteModal'
import Comments from './Comments'
import { Issue } from '../../types'
import { querySQL, sql } from '@livestore/livestore'
import { useStore, useTemporaryQuery } from '@livestore/livestore/react'

// This would be best:
// const issue$ = querySQL<Issue>((_) => sql`SELECT * FROM issue WHERE id = $id`).getFirstRow()
// const issue = useQuery(issue$, { id })

function IssuePage() {
  const navigate = useNavigate()
  const { id } = useParams() || ''

  const makeIssueQuery = useCallback(
    () => querySQL<Issue>((_) => sql`SELECT * FROM issue WHERE id = '${id}'`).getFirstRow(),
    [id],
  )
  const makeDescriptionQuery = useCallback(
    () => querySQL<{ body: string }>((_) => sql`SELECT body FROM description WHERE id = '${id}'`).getFirstRow(),
    [id],
  )
  const issue = useTemporaryQuery(makeIssueQuery)
  const description = useTemporaryQuery(makeDescriptionQuery).body
  const { store } = useStore()

  const [showDeleteModal, setShowDeleteModal] = useState(false)

  if (issue === undefined) {
    return <div className="p-8 w-full text-center">Loading...</div>
  } else if (issue === null) {
    return <div className="p-8 w-full text-center">Issue not found</div>
  }

  const handleStatusChange = (status: string) => {
    store.applyEvent('updateIssueStatus', {
      id: issue.id,
      status,
    })
  }

  const handlePriorityChange = (priority: string) => {
    store.applyEvent('updateIssuePriority', {
      id: issue.id,
      priority,
    })
  }

  const handleTitleChange = (title: string) => {
    store.applyEvent('updateIssueTitle', {
      id: issue.id,
      title,
    })
  }

  const handleDescriptionChange = (body: string) => {
    store.applyEvent('updateDescription', {
      id: issue.id,
      body,
    })
  }

  const handleDelete = () => {
    // TODO: how to create a tx?
    store.applyEvent('deleteIssue', {
      id: issue.id,
    })
    store.applyEvent('deleteDescription', {
      id: issue.id,
    })
    store.applyEvent('deleteCommentsByIssueId', {
      issueId: issue.id,
    })
    handleClose()
  }

  const handleClose = () => {
    if (window.history.length > 2) {
      navigate(-1)
    }
    navigate('/')
  }

  const shortId = () => {
    if (issue.id.includes('-')) {
      return issue.id.slice(issue.id.length - 8)
    } else {
      return issue.id
    }
  }

  return (
    <>
      <div className="flex flex-col flex-1 overflow-hidden">
        <div className="flex flex-col">
          <div className="flex justify-between flex-shrink-0 pr-6 border-b border-gray-200 h-14 pl-3 md:pl-5 lg:pl-9">
            <div className="flex items-center">
              <span className="font-semibold me-2">Issue</span>
              <span className="text-gray-500" title={issue.id}>
                {shortId()}
              </span>
            </div>

            <div className="flex items-center">
              <button className="p-2 rounded hover:bg-gray-100" onClick={() => setShowDeleteModal(true)}>
                <DeleteIcon size={14} />
              </button>
              <button className="ms-2 p-2 rounded hover:bg-gray-100" onClick={handleClose}>
                <CloseIcon size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* <div className="flex flex-col overflow-auto">issue info</div> */}
        <div className="flex flex-1 p-3 md:p-2 overflow-hidden flex-col md:flex-row">
          <div className="md:block flex md:flex-[1_0_0] min-w-0 md:p-3 md:order-2">
            <div className="max-w-4xl flex flex-row md:flex-col">
              <div className="flex flex-1 mb-3 mr-5 md-mr-0">
                <div className="flex flex-[2_0_0] mr-2 md-mr-0 items-center">Opened by</div>
                <div className="flex flex-[3_0_0]">
                  <button className="inline-flex items-center h-6 ps-1.5 pe-2 text-gray-500border-none rounded hover:bg-gray-100">
                    <Avatar name={issue.creator} />
                    <span className="ml-1">{issue.creator}</span>
                  </button>
                </div>
              </div>
              <div className="flex flex-1 mb-3 mr-5 md-mr-0">
                <div className="flex flex-[2_0_0] mr-2 md-mr-0 items-center">Status</div>
                <div className="flex flex-[3_0_0]">
                  <StatusMenu
                    id={'issue-status-' + issue.id}
                    button={
                      <button className="inline-flex items-center h-6 px-2 text-gray-500border-none rounded hover:bg-gray-100">
                        <StatusIcon status={issue.status} className="mr-1" />
                        <span>{StatusDisplay[issue.status]}</span>
                      </button>
                    }
                    onSelect={handleStatusChange}
                  />
                </div>
              </div>
              <div className="flex flex-1 mb-3 mr-5 md-mr-0">
                <div className="flex flex-[2_0_0] mr-2 md-mr-0 items-center">Priority</div>
                <div className="flex flex-[3_0_0]">
                  <PriorityMenu
                    id={'issue-priority-' + issue.id}
                    button={
                      <button className="inline-flex items-center h-6 px-2 text-gray-500 border-none rounded hover:bg-gray-100 hover:text-gray-700">
                        <PriorityIcon priority={issue.priority} className="mr-1" />
                        <span>{PriorityDisplay[issue.priority]}</span>
                      </button>
                    }
                    onSelect={handlePriorityChange}
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-col md:flex-[3_0_0] md:p-3 border-gray-200 md:border-r min-h-0 min-w-0 overflow-auto">
            <input
              className="w-full px-3 py-1 text-lg font-semibold placeholder-gray-400 border-transparent rounded "
              placeholder="Issue title"
              value={issue.title}
              onChange={(e) => handleTitleChange(e.target.value)}
            />

            <Editor
              className="prose w-full max-w-full mt-2 font-normal appearance-none min-h-12 p-3 text-md rounded editor"
              value={description || ''}
              onChange={(val) => handleDescriptionChange(val)}
              placeholder="Add description..."
            />
            <div className="border-t border-gray-200 mt-3 p-3">
              <h2 className="text-md mb-3">Comments</h2>
              <Comments issue={issue} />
            </div>
          </div>
        </div>
      </div>

      <DeleteModal
        isOpen={showDeleteModal}
        setIsOpen={setShowDeleteModal}
        onDismiss={() => setShowDeleteModal(false)}
        deleteIssue={handleDelete}
      />
    </>
  )
}

export default IssuePage
