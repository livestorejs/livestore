import { store } from './livestore/store.ts'

export default function App() {
  return store.schema.version
}
