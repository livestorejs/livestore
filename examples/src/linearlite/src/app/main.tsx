import '@/app/style.css'
import React from 'react'
import { createRoot } from 'react-dom/client'

import { Root } from '@/app/root'

const container = document.getElementById('root')!
const root = createRoot(container)
root.render(<Root />)
