import { useFrontendState } from '@/lib/livestore/queries'
import React from 'react'
import { Button } from 'react-aria-components'
import { Icon } from '../icons'

export const ToolbarButton = () => {
  const [frontendState, setFrontendState] = useFrontendState()
  const onClick = () => {
    setFrontendState({ ...frontendState, showToolbar: !frontendState.showToolbar })
  }

  return (
    <Button
      aria-label={frontendState.showToolbar ? 'Hide LiveStore Toolbar' : 'Show LiveStore Toolbar'}
      className="bg-white rounded-lg border border-gray-200 shadow size-8 flex items-center justify-center hover:bg-gray-100 focus:outline-none focus:bg-gray-100"
      onPress={onClick}
    >
      <Icon name="sidebar" className="size-5 -rotate-90" />
    </Button>
  )
}
