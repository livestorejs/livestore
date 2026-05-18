import 'todomvc-app-css/index.css'
import { mount } from 'svelte'

import App from './App.svelte'

mount(App, {
  target: document.querySelector('#root')!,
})
