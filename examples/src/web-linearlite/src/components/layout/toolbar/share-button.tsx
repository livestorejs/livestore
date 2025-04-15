import { CheckIcon, LinkIcon, QrCodeIcon } from '@heroicons/react/16/solid'
import React from 'react'
import { Button, ModalOverlay, Modal as ReactAriaModal } from 'react-aria-components'

// This uses a public QR code API: https://goqr.me/api/doc/create-qr-code/

export const ShareButton = ({ className }: { className?: string }) => {
  const [copied, setCopied] = React.useState(false)
  const [showQR, setShowQR] = React.useState(false)

  // TODO build sharable workspace feature
  const copyUrl = () => {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => {
      setCopied(false)
    }, 2000)
  }

  return (
    <>
      <div className={`flex items-center gap-1 ${className}`}>
        <span>Workspace:</span>
        <Button
          aria-label="Copy workspace URL"
          onPress={copyUrl}
          className="h-6 px-1.5 flex items-center gap-1 bg-neutral-800 rounded hover:bg-neutral-700 focus:bg-neutral-700 focus:outline-none whitespace-nowrap"
        >
          {copied ? (
            <>
              <CheckIcon className="size-3 shrink-0" />
              <span>
                <span className="hidden xl:inline">URL copied!</span>
                <span className="xl:hidden">Copied!</span>
              </span>
            </>
          ) : (
            <>
              <LinkIcon className="size-3 shrink-0" />
              <span>
                Share<span className="hidden xl:inline"> workspace</span>
              </span>
            </>
          )}
        </Button>
        <Button
          aria-label="Copy workspace URL"
          onPress={() => setShowQR(true)}
          className="size-6 flex items-center justify-center bg-neutral-800 rounded hover:bg-neutral-700 focus:outline-none focus:bg-neutral-800"
        >
          <QrCodeIcon className="size-3.5" />
        </Button>
      </div>
      <ModalOverlay
        isOpen={showQR}
        onOpenChange={setShowQR}
        className="fixed inset-0 bottom-12 bg-black/10 dark:bg-black/20 flex items-start justify-center p-4 pt-16 lg:pt-32"
        isDismissable
      >
        <ReactAriaModal className="relative bg-white rounded-xl shadow-lg border overflow-hidden border-neutral-200 p-4">
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
