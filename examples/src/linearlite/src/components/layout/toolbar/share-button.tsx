import { CheckIcon, LinkIcon, QrCodeIcon } from '@heroicons/react/16/solid'
import React from 'react'
import { Button, ModalOverlay, Modal as ReactAriaModal } from 'react-aria-components'

// This uses a public QR code API: https://goqr.me/api/doc/create-qr-code/

export const ShareButton = ({ className }: { className?: string }) => {
  const [copied, setCopied] = React.useState(false)
  const [showQR, setShowQR] = React.useState(false)

  const copyUrl = () => {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => {
      setCopied(false)
    }, 2000)
  }

  return (
    <>
      <div className={`lg:h-full flex items-center lg:border-r lg:border-gray-700 ${className}`}>
        <Button
          aria-label="Copy workspace URL"
          onPress={copyUrl}
          className="h-8 pl-2 pr-2.5 w-full lg:w-auto lg:border-y flex items-center gap-1 border-gray-700 text-sm hover:bg-gray-800 focus:outline-none text-gray-400"
        >
          {copied ? (
            <>
              <CheckIcon className="size-3" />
              <span>URL copied!</span>
            </>
          ) : (
            <>
              <LinkIcon className="size-3" />
              <span>Share workspace</span>
            </>
          )}
        </Button>
        <Button
          aria-label="Copy workspace URL"
          onPress={() => setShowQR(true)}
          className="size-8 lg:border-y border-l flex items-center justify-center gap-1 border-gray-700 text-sm hover:bg-gray-800 focus:outline-none text-gray-400"
        >
          <QrCodeIcon className="size-4" />
        </Button>
      </div>
      <ModalOverlay
        isOpen={showQR}
        onOpenChange={setShowQR}
        className="fixed inset-0 bottom-12 bg-black/10 dark:bg-black/20 flex items-start justify-center p-4 pt-16 lg:pt-32"
        isDismissable
      >
        <ReactAriaModal className="relative bg-white rounded-xl shadow-lg border overflow-hidden border-gray-200 p-4">
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURI(window.location.href)}`}
            crossOrigin="anonymous"
            width="200"
            height="200"
          />
        </ReactAriaModal>
      </ModalOverlay>
    </>
  )
}
