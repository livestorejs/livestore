import React from 'react'
import { Button } from 'react-aria-components'
import { Icon } from '../icons'

export const NewIssueButton = () => {
  return (
    <Button
      aria-label="New Issue"
      className="bg-white rounded-lg border border-gray-200 shadow size-8 flex items-center justify-center hover:bg-gray-100 focus:outline-none focus:bg-gray-100"
    >
      <Icon name="new-issue" className="size-4" />
    </Button>
  )
}
