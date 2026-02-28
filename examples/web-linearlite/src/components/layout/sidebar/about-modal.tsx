import { Modal } from '../../common/modal.tsx'

export const AboutModal = ({ show, setShow }: { show: boolean; setShow: (show: boolean) => void }) => {
  return (
    <Modal show={show} setShow={setShow} title="About LinearLite">
      <div className="p-4 text-sm flex flex-col gap-2 text-neutral-500">
        <p>
          LinearLite is an example of a collaboration application using a local-first approach, obviously inspired by{' '}
          <a href="https://linear.app" target="_blank" rel="noreferrer" className="underline text-orange-600">
            Linear
          </a>
          .
        </p>
        <p>
          It's built using{' '}
          <a href="https://www.livestore.dev" target="_blank" rel="noreferrer" className="underline text-orange-600">
            LiveStore
          </a>
          , a local-first sync layer for web and mobile apps.
        </p>
      </div>
    </Modal>
  )
}
