import { App } from '@/app/app'
import '@/app/style.css'
import { createRoot } from 'react-dom/client'

const root = createRoot(document.getElementById('root')!)
root.render(<App />)
