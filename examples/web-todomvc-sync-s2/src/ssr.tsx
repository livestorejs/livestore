import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'

import { createRouter } from './router.js'

export default createStartHandler({
  createRouter,
})(defaultStreamHandler)
