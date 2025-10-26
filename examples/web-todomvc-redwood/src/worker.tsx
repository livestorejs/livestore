import { render, route } from 'rwsdk/router'
import { defineApp } from 'rwsdk/worker'

import { Document } from './app/Document.tsx'
import { setCommonHeaders } from './app/headers.ts'
import { Home } from './app/pages/Home.tsx'

export type AppContext = {}

export default defineApp([setCommonHeaders(), render(Document, [route('/', Home)])])
