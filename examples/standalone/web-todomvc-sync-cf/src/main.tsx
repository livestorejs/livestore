import 'todomvc-app-css/index.css'

import React from 'react'
import ReactDOM from 'react-dom/client'

import { App } from './Root.js'

ReactDOM.createRoot(document.getElementById('react-app')!).render(<App />)

// ReactDOM.createRoot(document.getElementById('react-app')!).render(
//   <React.StrictMode>
//     <App />
//   </React.StrictMode>,
// )
