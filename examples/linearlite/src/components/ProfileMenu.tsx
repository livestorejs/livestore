import React from 'react'
import { Transition } from '@headlessui/react'
import classnames from 'classnames'
import { useClickOutside } from '../hooks/useClickOutside'
import Toggle from './Toggle'
import { useRef } from 'react'

interface Props {
  isOpen: boolean
  onDismiss?: () => void
  setShowAboutModal?: (show: boolean) => void
  className?: string
}
export default function ProfileMenu({ isOpen, className, onDismiss, setShowAboutModal }: Props) {
  // const { connectivityState, toggleConnectivityState } = useConnectivityState()
  const connectivityState: string = 'connected'
  const toggleConnectivityState = () => {}
  const classes = classnames(
    'select-none w-53 shadow-modal z-50 flex flex-col py-1 bg-white font-normal rounded text-gray-800',
    className,
  )
  const ref = useRef(null)

  const connectivityConnected = connectivityState !== 'disconnected'
  const connectivityStateDisplay = connectivityState[0]?.toUpperCase() + connectivityState.slice(1)

  useClickOutside(ref, () => {
    if (isOpen && onDismiss) {
      onDismiss()
    }
  })

  return (
    <div ref={ref}>
      <Transition
        as="div"
        show={isOpen}
        enter="transition ease-out duration-100"
        enterFrom="transform opacity-0 scale-95"
        enterTo="transform opacity-100 scale-100"
        leave="transition easy-in duration-75"
        leaveFrom="transform opacity-100 scale-100"
        leaveTo="transform opacity-0 scale-95"
        className={classes}
      >
        <button
          className="flex items-center h-8 px-3 hover:bg-gray-100"
          onClick={() => {
            setShowAboutModal?.(true)
            onDismiss?.()
          }}
        >
          About
        </button>
        <a href="https://github.com/livestorejs/livestore" className="flex items-center h-8 px-3 hover:bg-gray-100">
          Visit LiveStore
        </a>
        <a href="https://github.com/livestorejs/livestore" className="flex items-center h-8 px-3 hover:bg-gray-100">
          Documentation
        </a>
        <a
          href="https://github.com/livestorejs/livestore/tree/main/examples/linearlite"
          className="flex items-center h-8 px-3 hover:bg-gray-100"
        >
          GitHub
        </a>
        <div className="border-t flex items-center h-8 px-3">
          <span className="text-gray-500 me-auto">{connectivityStateDisplay}</span>
          <Toggle
            value={connectivityConnected}
            onChange={toggleConnectivityState}
            activeClass="bg-green-500 hover:bg-green-700"
            activeLabelClass="border-green-500"
          />
        </div>
      </Transition>
    </div>
  )
}
