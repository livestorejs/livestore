import './otel.ts'
import './styles.css'

import { RouterProvider } from '@tanstack/react-router'
import ReactDOM from 'react-dom/client'

import { router } from './router.tsx'

ReactDOM.createRoot(document.getElementById('react-app')!).render(<RouterProvider router={router} />)
