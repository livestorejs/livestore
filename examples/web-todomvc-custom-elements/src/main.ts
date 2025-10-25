// import 'todomvc-app-css/index.css'
// import './index.css'

import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { createStorePromise, liveStoreVersion, queryDb } from '@livestore/livestore'

import LiveStoreWorker from './livestore.worker.ts?worker'
import { events, SyncPayload, schema, type Todo, tables } from './schema.ts'

// These are here to try to get editors to highlight strings correctly 😔
export const html = (strings: TemplateStringsArray, ...values: unknown[]) =>
  parseTemplate(String.raw({ raw: strings }, ...values))
export const css = (strings: TemplateStringsArray, ...values: unknown[]) => String.raw({ raw: strings }, ...values)

const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
})

const syncPayload = { authToken: 'insecure-token-change-me' }

const store = await createStorePromise({
  schema,
  adapter,
  storeId: 'todomvc-custom-elements',
  syncPayloadSchema: SyncPayload,
  syncPayload,
})

// Add version badge
console.log(`LiveStore v${liveStoreVersion}`)
const versionBadge = document.createElement('div')
versionBadge.textContent = `v${liveStoreVersion}`
versionBadge.style.cssText = `
  position: fixed;
  bottom: 16px;
  right: 16px;
  background: rgba(0, 0, 0, 0.8);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  color: white;
  z-index: 1000;
  user-select: none;
`
document.body.appendChild(versionBadge)

const appState$ = queryDb(tables.uiState.get())
const todos$ = queryDb(tables.todos.where({ deletedAt: null }))

const updatedNewTodoText = (text: string) => store.commit(events.uiStateSet({ newTodoText: text }))

const todoCreated = (text: string) =>
  store.commit(events.todoCreated({ id: crypto.randomUUID(), text }), events.uiStateSet({ newTodoText: '' }))

const toggleTodo = (todo: Todo) => {
  if (todo.completed) {
    store.commit(events.todoUncompleted({ id: todo.id }))
  } else {
    store.commit(events.todoCompleted({ id: todo.id }))
  }
}

const todoDeleted = (todo: Todo) => store.commit(events.todoDeleted({ id: todo.id, deletedAt: new Date() }))

const TodoItemTemplate = html`
  <link rel="stylesheet" href="/src/index.css" />
  <li class="relative text-2xl border-b border-b-[#ededed] group">
    <div class="flex">
      <input type="checkbox" class="toggle ml-4" />
      <label
        class="break-words pr-[15px] py-[15px] pl-[30px] block leading-6 transition-colors duration-400 font-normal text-[#484848]"
      ></label>
      <button
        class="hidden absolute top-0 right-[10px] bottom-0 w-[40px] h-[40px] my-auto text-[30px] text-[#949494] transition-colors duration-200 ease-out hover:text-[#C18585] after:content-['x'] group-hover:block"
      ></button>
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
      todoDeleted(this.#todo)
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
  <link rel="stylesheet" href="/src/index.css" />
  <header>
    <form>
      <input
        class="relative m-0 w-full text-2xl font-inherit leading-7 text-inherit p-4 pl-[60px] border-none shadow-[inset_0_-2px_1px_0_rgba(0,0,0,0.08)] box-border focus:outline-0 focus:shadow-[0_0_2px_2px_#CF7D7D]"
        autofocus
        placeholder="What needs to be done?"
      />
    </form>
  </header>
  <section class="main">
    <ul class="list-none">
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
    updatedNewTodoText(input.value)
  }

  onSubmit(e: Event) {
    e.preventDefault()
    const input = this.shadowRoot!.querySelector('input')
    todoCreated(input!.value)
  }

  #todos: ReadonlyArray<Todo> = []

  connectedCallback() {
    const input = this.shadowRoot!.querySelector('input')!

    // NOTE: can we get an AsyncIterator for newValues as well?
    // TODO unsubscribe
    store.subscribe(todos$, (newValue) => {
      this.#todos = newValue
      this.updateTodoItems()
    })

    // TODO unsubscribe
    store.subscribe(appState$, (newValue) => {
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
