import { Button } from 'react-aria-components'
import { Icon } from '@/components/icons'
import { useFrontendState } from '@/lib/livestore/queries'

export const ToolbarButton = () => {
  const [frontendState, setFrontendState] = useFrontendState()
  const onClick = () => {
    setFrontendState({ ...frontendState, showToolbar: !frontendState.showToolbar })
  }

  return (
    <Button
      aria-label={frontendState.showToolbar ? 'Hide LiveStore Toolbar' : 'Show LiveStore Toolbar'}
      className="bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-700 shadow size-8 flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-800 focus:outline-none focus:bg-neutral-100 dark:focus:bg-neutral-800"
      onPress={onClick}
    >
      <Icon name="sidebar" className="size-5 -rotate-90" />
    </Button>
  )
}
