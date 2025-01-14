import { StatusOptions } from '@/data/status-options'
import { Status } from '@/types/status'
import classNames from 'classnames'
import React from 'react'

interface Props {
  status: Status
  className?: string
}

export default function StatusIcon({ status, className }: Props) {
  const classes = classNames('w-3.5 h-3.5 rounded', className)

  const Icon = StatusOptions[status].Icon

  return <Icon className={classes} />
}
