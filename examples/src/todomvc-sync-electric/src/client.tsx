/// <reference types="vinxi/types/client" />
import { StartClient } from '@tanstack/start'
import React from 'react'
import { hydrateRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'

if (import.meta.env.PROD) {
  registerSW()
}

import { createRouter } from './router.js'

const router = createRouter()

hydrateRoot(document!, <StartClient router={router} />)
