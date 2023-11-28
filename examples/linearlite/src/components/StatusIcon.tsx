import classNames from 'classnames'
import { StatusIcons, StatusType } from '../types/issue'

interface Props {
  status: StatusType
  className?: string
}

export default function StatusIcon({ status, className }: Props) {
  const classes = classNames('w-3.5 h-3.5 rounded', className)

  const Icon = StatusIcons[status]

  return <Icon className={classes} />
}
