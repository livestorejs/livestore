import React from 'react'
import 'animate.css/animate.min.css'
import Board from './pages/Board'
import { useState } from 'react'
import { Route, Routes, BrowserRouter } from 'react-router-dom'
import { cssTransition, ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import { List } from './pages/List'
import { IssuePage } from './pages/Issue'
import { LeftMenu } from './components/LeftMenu'
import { MenuContext } from './context/MenuContext'

const slideUp = cssTransition({
  enter: 'animate__animated animate__slideInUp',
  exit: 'animate__animated animate__slideOutDown',
})

// function deleteDB() {
//   console.log("Deleting DB as schema doesn't match server's")
//   const DBDeleteRequest = window.indexedDB.deleteDatabase(dbName)
//   DBDeleteRequest.onsuccess = function () {
//     console.log('Database deleted successfully')
//   }
//   // the indexedDB cannot be deleted if the database connection is still open,
//   // so we need to reload the page to close any open connections.
//   // On reload, the database will be recreated.
//   window.location.reload()
// }

export const App = () => {
  const [showMenu, setShowMenu] = useState(false)

  const router = (
    <Routes>
      <Route path="/" element={<List />} />
      <Route path="/search" element={<List showSearch={true} />} />
      <Route path="/board" element={<Board />} />
      <Route path="/issue/:id" element={<IssuePage />} />
    </Routes>
  )

  return (
    <MenuContext.Provider value={{ showMenu, setShowMenu }}>
      <BrowserRouter>
        <div className="flex w-full h-screen overflow-y-hidden">
          <LeftMenu />
          {router}
        </div>
        <ToastContainer
          position="bottom-right"
          autoClose={5000}
          hideProgressBar
          newestOnTop
          closeOnClick
          rtl={false}
          transition={slideUp}
          pauseOnFocusLoss
          draggable
          pauseOnHover
        />
      </BrowserRouter>
    </MenuContext.Provider>
  )
}
