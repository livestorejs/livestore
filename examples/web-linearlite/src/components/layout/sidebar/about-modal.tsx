import { Link } from 'react-router-dom'
import { Modal } from '@/components/common/modal'

export const AboutModal = ({ show, setShow }: { show: boolean; setShow: (show: boolean) => void }) => {
  return (
    <Modal show={show} setShow={setShow} title="About LinearLite">
      <div className="p-4 text-sm flex flex-col gap-2 text-neutral-500">
        <p>
          LinearLite is an example of a collaboration application using a local-first approach, obviously inspired by{' '}
          <Link to="https://linear.app" target="_blank" className="underline text-orange-600">
            Linear
          </Link>
          .
        </p>
        <p>
          It's built using{' '}
          <Link to="https://www.livestore.dev" target="_blank" className="underline text-orange-600">
            LiveStore
          </Link>
          , a local-first sync layer for web and mobile apps.
        </p>
      </div>
    </Modal>
  )
}
