import { StartClient } from '@tanstack/react-start'
import { hydrateRoot } from 'react-dom/client'

import { createRouter } from './router.js'

const router = createRouter()

hydrateRoot(document!, <StartClient router={router} />)
