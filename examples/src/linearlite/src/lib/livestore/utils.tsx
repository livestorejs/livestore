import { BootStatus } from '@livestore/livestore'
import React from 'react'

export const renderBootStatus = (bootStatus: BootStatus) => {
  switch (bootStatus.stage) {
    case 'loading':
      return <div>Loading LiveStore...</div>
    case 'migrating':
      return (
        <div>
          Migrating tables ({bootStatus.progress.done}/{bootStatus.progress.total})
        </div>
      )
    case 'rehydrating':
      return (
        <div>
          Rehydrating state ({bootStatus.progress.done}/{bootStatus.progress.total})
        </div>
      )
    case 'syncing':
      return (
        <div>
          Syncing state ({bootStatus.progress.done}/{bootStatus.progress.total})
        </div>
      )
    case 'done':
      return <div>LiveStore ready</div>
  }
}
