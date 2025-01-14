import { LeftMenu } from '@/components/LeftMenu'
import { MenuContext } from '@/context/MenuContext'
import Board from '@/pages/Board'
import { IssuePage } from '@/pages/Issue'
import { List } from '@/pages/List'
import 'animate.css/animate.min.css'
import React, { useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'

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
      </BrowserRouter>
    </MenuContext.Provider>
  )
}
