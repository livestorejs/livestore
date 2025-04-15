/// <reference types="vinxi/types/client" />
import { StartClient } from '@tanstack/react-start'
import React from 'react'
import { hydrateRoot } from 'react-dom/client'

import { createRouter } from './router.js'

const router = createRouter()

hydrateRoot(document!, <StartClient router={router} />)
