/* eslint-disable prefer-arrow/prefer-arrow-functions */
import 'todomvc-app-css/index.css'

import { createStore, querySQL, sql } from '@livestore/livestore'
import { WebWorkerStorage } from '@livestore/livestore/storage/web-worker'
import { uuid } from '@livestore/utils'
import initSqlite3Wasm from 'sqlite-esm'

import type { AppState, Todo } from './schema.js'
import { schema } from './schema.js'

// These are here to try to get editors to highlight strings correctly 😔
export const html = (strings: TemplateStringsArray, ...values: unknown[]) =>
  parseTemplate(String.raw({ raw: strings }, ...values))
export const css = (strings: TemplateStringsArray, ...values: unknown[]) => String.raw({ raw: strings }, ...values)

const sqlite3Promise = initSqlite3Wasm({
  print: (message) => console.log(`[livestore sqlite] ${message}`),
  printErr: (message) => console.error(`[livestore sqlite] ${message}`),
})

const store = await createStore({
  schema,
  loadStorage: () => WebWorkerStorage.load({ fileName: 'app.db', type: 'opfs' }),
  boot: async (backend) => {
    console.debug("I'm in boot")
    backend.execute(sql`INSERT INTO app (newTodoText, filter) VALUES ('', 'all');`)
  },
  sqlite3: await sqlite3Promise,
})

console.debug({ store })

const appState = querySQL<AppState>(`select newTodoText, filter from app;`).getFirstRow()
const todos = querySQL<Todo>(`select * from todos`)

const updateNewTodoText = (text: string) => store.applyEvent('updateNewTodoText', { text })

const addTodo = (newTodoText: string) => {
  store.applyEvent('addTodo', { id: uuid(), text: newTodoText })
  store.applyEvent('updateNewTodoText', { text: '' })
}

const toggleTodo = (todo: Todo) => {
  if (todo.completed) {
    store.applyEvent('uncompleteTodo', { id: todo.id })
  } else {
    store.applyEvent('completeTodo', { id: todo.id })
  }
}

const deleteTodo = (todo: Todo) => {
  store.applyEvent('deleteTodo', { id: todo.id })
}

console.debug({ appState })

const TodoItemTemplate = html`
  <li>
    <div class="view">
      <input type="checkbox" class="toggle" />
      <label></label>
      <button class="destroy">Delete</button>
    </div>
  </li>
`

class TodoItem extends HTMLElement {
  #todo: Todo | null

  constructor() {
    super()
    this.#todo = null
    const shadowRoot = this.attachShadow({ mode: 'open' })
    shadowRoot.append(TodoItemTemplate.cloneNode())

    const button = shadowRoot.querySelector('button')!
    button.addEventListener('click', this.onDelete.bind(this))

    const checkbox = shadowRoot.querySelector('input[type=checkbox]')!
    checkbox.addEventListener('change', this.onToggle.bind(this))
  }

  onDelete() {
    if (this.#todo) {
      deleteTodo(this.#todo)
    }
  }

  onToggle() {
    if (this.#todo) {
      toggleTodo(this.#todo)
    }
  }

  set todo(t: Todo | null) {
    this.#todo = t
    this.updateTemplate()
  }

  get todo(): Todo | null {
    return this.#todo
  }

  updateTemplate() {
    console.debug({ shadowRoot: this.shadowRoot })

    const label = this.shadowRoot!.querySelector('label')
    label!.textContent = this.#todo?.text || ''

    const checkbox = this.shadowRoot!.querySelector('input')
    checkbox!.checked = !!this.#todo?.completed
  }
}

customElements.define('todo-item', TodoItem)

const TodoListTemplate = html`
  <header className="header">
    <h1>todos</h1>
    <form>
      <label
        >Add a todo
        <input class="new-todo" autofocus placeholder="What needs to be done?" />
      </label>
      <button type="submit">Add</button>
    </form>
  </header>
  <section class="main">
    <ul class="todo-list">
      <slot></slot>
    </ul>
  </section>
`

class TodoList extends HTMLElement {
  constructor() {
    super()
    const shadowRoot = this.attachShadow({ mode: 'open' })
    shadowRoot.append(TodoListTemplate.cloneNode())

    const input = shadowRoot.querySelector('input')
    input?.addEventListener('input', this.onInput.bind(this))

    const form = shadowRoot.querySelector('form')
    form?.addEventListener('submit', this.onSubmit.bind(this))
  }

  onInput(e: Event) {
    const input = e.target as HTMLInputElement
    updateNewTodoText(input.value)
  }

  onSubmit(e: Event) {
    e.preventDefault()
    const input = this.shadowRoot!.querySelector('input')
    addTodo(input!.value)
  }

  #todos: ReadonlyArray<Todo> = []

  connectedCallback() {
    console.debug('boom')
    const input = this.shadowRoot!.querySelector('input')!

    // NOTE: can we get an AsyncIterator for newValues as well?
    store.subscribe(todos, (newValue) => {
      this.#todos = newValue
      this.updateTodoItems()
    })

    store.subscribe(appState, (newValue) => {
      input.value = newValue.newTodoText
    })
  }

  updateTodoItems() {
    // TODO: don't clear, just update existing or add/remove
    this.replaceChildren()

    for (const todo of this.#todos) {
      const todoEl = document.createElement('todo-item') as TodoItem
      todoEl.todo = todo
      this.append(todoEl)
    }
  }
}

customElements.define('todo-list', TodoList)

export function parseTemplate(source: string) {
  const el = document.createElement('template')
  el.innerHTML = source

  return {
    source,
    cloneNode() {
      return el.content.cloneNode(true)
    },
  }
}
