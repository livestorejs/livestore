import '@/app/style.css'

import { App } from '@/app/app'
import React from 'react'
import { createRoot } from 'react-dom/client'

const root = createRoot(document.getElementById('root')!)
root.render(<App />)
