import { PriorityOptions } from '@/data/priority-options'
import { Priority } from '@/types/priority'
import classNames from 'classnames'
import React from 'react'

interface Props {
  priority: Priority
  className?: string
}

export default function PriorityIcon({ priority, className }: Props) {
  const classes = classNames('w-4 h-4', className)
  const Icon = PriorityOptions[priority].Icon
  return <Icon className={classes} />
}
