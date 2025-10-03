import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { createStorePromise, queryDb } from '@livestore/livestore'

import LiveStoreWorker from './livestore/livestore.worker.ts?worker'
import { events, schema, tables } from './livestore/schema.ts'

const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
})

const store = await createStorePromise({ schema, adapter, storeId: 'custom-elements-demo' })

const visibleTodos$ = queryDb(tables.todos.where({ deletedAt: null }))

class TodoListElement extends HTMLElement {
  private list: HTMLUListElement
  private input: HTMLInputElement

  constructor() {
    super()
    const shadow = this.attachShadow({ mode: 'open' })

    this.input = document.createElement('input')
    this.input.placeholder = 'What needs to be done?'

    this.list = document.createElement('ul')
    this.list.style.listStyle = 'none'
    this.list.style.padding = '0'
    this.list.style.margin = '16px 0 0'

    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && this.input.value.trim()) {
        store.commit(events.todoCreated({ id: crypto.randomUUID(), text: this.input.value.trim() }))
        this.input.value = ''
      }
    })

    shadow.append(this.input, this.list)
  }

  connectedCallback(): void {
    this.renderTodos(Array.from(store.query(tables.todos.where({ deletedAt: null }))))

    store.subscribe(visibleTodos$, {
      onUpdate: (todos) => this.renderTodos(todos),
    })
  }

  private renderTodos(todos: ReadonlyArray<typeof tables.todos.Type>): void {
    const nodes = Array.from(todos, (todo) => {
      const item = document.createElement('li')
      item.textContent = todo.text
      item.style.cursor = 'pointer'
      item.addEventListener('click', () => {
        store.commit(todo.completed ? events.todoUncompleted({ id: todo.id }) : events.todoCompleted({ id: todo.id }))
      })

      const deleteButton = document.createElement('button')
      deleteButton.type = 'button'
      deleteButton.textContent = '✕'
      deleteButton.style.marginLeft = '8px'
      deleteButton.addEventListener('click', (event) => {
        event.stopPropagation()
        store.commit(events.todoDeleted({ id: todo.id, deletedAt: new Date() }))
      })

      const row = document.createElement('div')
      row.style.display = 'flex'
      row.style.alignItems = 'center'
      row.appendChild(item)
      row.appendChild(deleteButton)

      const wrapper = document.createElement('li')
      wrapper.appendChild(row)
      return wrapper
    })

    this.list.replaceChildren(...nodes)
  }
}

customElements.define('todo-list', TodoListElement)
