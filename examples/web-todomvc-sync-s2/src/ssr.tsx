import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'

import { createRouter } from './router.ts'

export default createStartHandler({
  createRouter,
})(defaultStreamHandler)
