import { FPSMeter } from '@overengineering/fps-meter'
import React from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../icons'
import { ResetButton } from './reset-button'
import { SeedInput } from './seed-input'
import { UserInput } from './user-input'

export const Toolbar = () => {
  return (
    <div className="w-screen h-12 bg-gray-900 flex items-center">
      <div className="h-8 border-y border-gray-700 w-2" />
      <div className="h-full flex items-center border-x border-gray-700">
        <Link
          to="https://livestore.dev/"
          target="_blank"
          className="flex items-center gap-2 text-sm font-bold text-gray-300 hover:bg-gray-800 px-2 border-y border-gray-700 h-8"
        >
          <Icon name="livestore" className="size-5 mt-1" />
          <span>LiveStore</span>
        </Link>
      </div>
      <UserInput />
      <SeedInput />
      <ResetButton />
      <div className="grow h-8 border-y border-gray-700" />
      <div className="h-full flex items-center border-x border-gray-700">
        <FPSMeter height={32} />
      </div>
      <div className="h-8 border-y border-gray-700 w-2" />
    </div>
  )
}
