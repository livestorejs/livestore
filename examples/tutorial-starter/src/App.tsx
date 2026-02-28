import { useCallback, useState } from 'react'

interface Todo {
  id: number
  text: string
}

const App = () => {
  const [todos, setTodos] = useState<Todo[]>([])
  const [input, setInput] = useState('')

  const addTodo = useCallback(() => {
    if (input.trim()) {
      const newTodo: Todo = {
        id: Date.now(),
        text: input,
      }
      setTodos([...todos, newTodo])
      setInput('')
    }
  }, [input, todos])

  const deleteTodo = useCallback(
    (id: number) => {
      setTodos(todos.filter((todo) => todo.id !== id))
    },
    [todos],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        addTodo()
      }
    },
    [addTodo],
  )

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value)
  }, [])

  const handleDeleteTodo = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const id = Number(e.currentTarget.dataset.todoId)
      if (!Number.isNaN(id)) {
        deleteTodo(id)
      }
    },
    [deleteTodo],
  )

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <h1 className="text-5xl font-bold text-gray-800 text-center mb-12">Todo List</h1>

        <div className="flex gap-3 mb-8">
          <input
            type="text"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Enter a todo..."
            className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            type="button"
            onClick={addTodo}
            className="px-6 py-2 text-sm font-medium text-white bg-blue-500 rounded hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
          >
            Add
          </button>
        </div>

        <div className="space-y-3">
          {todos.map((todo) => (
            <div key={todo.id} className="flex items-center justify-between bg-white px-4 py-3 rounded shadow-sm">
              <span className="text-gray-700">{todo.text}</span>
              <button
                type="button"
                data-todo-id={todo.id}
                onClick={handleDeleteTodo}
                className="px-4 py-1 text-sm font-medium text-white bg-red-500 rounded hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors"
              >
                Delete
              </button>
            </div>
          ))}
        </div>

        {todos.length === 0 && <p className="text-center text-gray-400 mt-8">No todos yet. Add one above!</p>}
      </div>
    </div>
  )
}

export default App
