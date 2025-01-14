import { FPSMeter } from '@overengineering/fps-meter'
import React from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../icons'

export const Toolbar = () => {
  return (
    <div className="w-screen h-12 bg-white border-t border-gray-200 flex items-center pl-4 pr-2 justify-between">
      <div>
        <Link to="https://livestore.dev/" target="_blank" className="flex items-center gap-2 text-sm font-bold">
          <Icon name="livestore" className="size-5 mt-1" />
          <span>LiveStore</span>
        </Link>
      </div>
      <FPSMeter className="bg-black/30" height={32} />
    </div>
  )
}
