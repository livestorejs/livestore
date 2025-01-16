import { FPSMeter } from '@overengineering/fps-meter'
import React from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../icons'
import { ResetButton } from './reset-button'

export const Toolbar = () => {
  return (
    <div className="w-screen h-12 bg-gray-800 flex items-center pl-4 pr-2 justify-between">
      <div className="flex items-center gap-8">
        <Link
          to="https://livestore.dev/"
          target="_blank"
          className="flex items-center gap-2 text-sm font-bold text-gray-300"
        >
          <Icon name="livestore" className="size-5 mt-1" />
          <span>LiveStore</span>
        </Link>
        <div>
          <ResetButton />
        </div>
      </div>
      <FPSMeter height={32} />
    </div>
  )
}
