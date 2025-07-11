import 'todomvc-app-css/index.css'

import ReactDOM from 'react-dom/client'

import { App } from './Root.jsx'

ReactDOM.createRoot(document.getElementById('react-app')!).render(<App />)

// ReactDOM.createRoot(document.getElementById('react-app')!).render(
//   <React.StrictMode>
//     <App />
//   </React.StrictMode>,
// )
