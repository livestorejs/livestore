/// <reference types="vite/client" />

import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { queryDb, type SyncState } from '@livestore/livestore'
import { LiveStoreProvider, useClientDocument, useStore } from '@livestore/react'
import React, { useRef, useState } from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { events, schema, tables } from './livestore/schema.ts'
import LiveStoreWorker from './livestore.worker.ts?worker'

// Define queries
const messagesQuery = queryDb(tables.messages.where({}), { label: 'messages' })
const reactionsQuery = queryDb(tables.reactions.where({}), {
  label: 'reactions',
})
const usersQuery = queryDb(tables.users.where({}), { label: 'users' })

// Main chat component that uses LiveStore hooks
const ChatComponent = () => {
  const { store } = useStore()
  const [currentMessage, setCurrentMessage] = useState('')
  const [showReactionPicker, setShowReactionPicker] = useState<string | null>(null)
  const [darkMode, setDarkMode] = useState(() => {
    // Check localStorage and system preference
    const saved = localStorage.getItem('darkMode')
    if (saved !== null) return saved === 'true'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  const [uiState] = useClientDocument(tables.uiState)
  const userContext = uiState.userContext!

  React.useEffect(() => {
    fetch(`http://localhost:8787/client-do?storeId=${store.storeId}`)
      .then((res) => res.json())
      .then((data) => {
        console.log('do state', data)
      })
  }, [store.storeId])

  // Apply dark mode class to document
  React.useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    localStorage.setItem('darkMode', String(darkMode))
  }, [darkMode])

  // Close reaction picker when clicking outside
  React.useEffect(() => {
    const handleClickOutside = () => {
      setShowReactionPicker(null)
    }

    if (showReactionPicker) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [showReactionPicker])

  // Get messages, reactions, and users from the store using store.useQuery
  const messages = store.useQuery(messagesQuery)
  const reactions = store.useQuery(reactionsQuery)
  const users = store.useQuery(usersQuery)

  const sendMessage = () => {
    if (!store || !currentMessage.trim()) return

    store.commit(
      events.messageCreated({
        id: crypto.randomUUID(),
        text: currentMessage.trim(),
        userId: userContext.userId,
        username: userContext.username,
        timestamp: new Date(),
        isBot: false,
      }),
    )

    setCurrentMessage('')
  }

  const getReactionsForMessage = (messageId: string) => {
    return reactions.filter((r) => r.messageId === messageId)
  }

  const addReaction = (messageId: string, emoji: string) => {
    store.commit(
      events.reactionAdded({
        id: crypto.randomUUID(),
        messageId,
        emoji,
        userId: userContext.userId,
        username: userContext.username,
      }),
    )
    setShowReactionPicker(null)
  }

  const toggleReactionPicker = (messageId: string) => {
    setShowReactionPicker(showReactionPicker === messageId ? null : messageId)
  }

  const availableEmojis = ['👍', '❤️', '😂', '😮', '😢', '😡', '🎉', '🔥']

  const toggleDarkMode = () => {
    setDarkMode(!darkMode)
  }

  // Filter out the current user from the users list to avoid duplication
  const otherUsers = users.filter((user) => user.userId !== userContext.userId)

  return (
    <div className="flex h-screen max-w-7xl mx-auto bg-white dark:bg-gray-900 transition-colors">
      {/* User sidebar - hidden on mobile, shown on desktop */}
      <div className="hidden md:flex md:w-64 bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 p-4 flex-col overflow-y-auto transition-colors">
        <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-200 mb-4">
          Chat Users ({otherUsers.length + 2})
        </h3>

        {/* Current user */}
        <div data-testid={`user-current-user`} className="px-3 py-2 bg-blue-500 text-white rounded-lg text-sm mb-2">
          {userContext.username} (You)
        </div>

        {/* Other users */}
        {otherUsers.map((user) => (
          <div
            key={user.userId}
            data-testid={`user-${user.userId}`}
            className="px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm mb-2 text-gray-900 dark:text-gray-100"
          >
            {user.username}
          </div>
        ))}

        {/* Bot */}
        <div data-testid="user-bot" className="px-3 py-2 bg-green-500 text-white rounded-lg text-sm mt-2">
          ChatBot 🤖
        </div>

        <SyncStates />
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col p-4 md:p-6">
        {/* Header with responsive title, dark mode toggle, and mobile user count */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl md:text-2xl font-bold text-gray-800 dark:text-gray-100">
            💬 LiveStore Chat
            <span className="hidden md:inline"> - {uiState.userContext?.username}</span>
          </h1>
          <div className="flex items-center gap-4">
            {/* Dark mode toggle */}
            <button
              type="button"
              data-testid="dark-mode-toggle"
              onClick={toggleDarkMode}
              className="p-2 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {darkMode ? '☀️' : '🌙'}
            </button>
            {/* Mobile user count */}
            <div className="md:hidden text-sm text-gray-600 dark:text-gray-400">{otherUsers.length + 2} users</div>
          </div>
        </div>

        {/* Messages container */}
        <div className="flex-1 border border-gray-300 dark:border-gray-700 rounded-lg overflow-y-auto p-4 mb-4 bg-gray-50 dark:bg-gray-800 min-h-0 transition-colors">
          {messages.map((message) => {
            const messageReactions = getReactionsForMessage(message.id)

            return (
              <div
                key={message.id}
                data-testid={`message-${message.id}`}
                className={`mb-3 p-3 rounded-lg border transition-colors ${
                  message.isBot
                    ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                    : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600'
                }`}
              >
                <div className="text-xs text-gray-600 dark:text-gray-400 mb-1 flex items-center gap-2">
                  <span className="font-medium">
                    {message.username}
                    {message.isBot && ' 🤖'}
                  </span>
                  <span className="text-gray-400 dark:text-gray-500">{message.timestamp.toLocaleTimeString()}</span>
                </div>
                <div className="text-gray-800 dark:text-gray-200 mb-2">{message.text}</div>

                <div className="flex items-center gap-2 mt-2">
                  {messageReactions.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {messageReactions.map((reaction) => (
                        <span
                          key={reaction.id}
                          data-testid={`reaction-${reaction.id}`}
                          className="inline-block bg-gray-200 dark:bg-gray-600 px-2 py-1 rounded-full text-xs"
                        >
                          {reaction.emoji}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="relative">
                    <button
                      type="button"
                      data-testid={`add-reaction-${message.id}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleReactionPicker(message.id)
                      }}
                      className="bg-transparent border border-gray-300 dark:border-gray-600 rounded-full px-2 py-1 text-xs cursor-pointer text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      ➕
                    </button>

                    {showReactionPicker === message.id && (
                      <div
                        data-testid={`reaction-picker-${message.id}`}
                        className="absolute bottom-full left-0 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg p-2 flex gap-1 shadow-lg z-10 mb-1"
                      >
                        {availableEmojis.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            data-testid={`emoji-${emoji}`}
                            onClick={() => addReaction(message.id, emoji)}
                            className="bg-transparent border-none p-1 rounded cursor-pointer text-base hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Input area */}
        <div className="flex gap-2 md:gap-3">
          <input
            data-testid="message-input"
            type="text"
            value={currentMessage}
            onChange={(e) => setCurrentMessage(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          />
          <button
            type="button"
            data-testid="send-message"
            onClick={sendMessage}
            disabled={!currentMessage.trim()}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              currentMessage.trim()
                ? 'bg-green-500 hover:bg-green-600 text-white cursor-pointer'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

// Main App component with LiveStore provider
const App = () => {
  const storeId = getStoreId()
  const adapter = makePersistedAdapter({
    storage: { type: 'opfs' },
    worker: LiveStoreWorker,
    sharedWorker: LiveStoreSharedWorker,
  })

  return (
    <LiveStoreProvider
      schema={schema}
      storeId={storeId}
      renderLoading={() => <div>Loading...</div>}
      adapter={adapter}
      batchUpdates={batchUpdates}
    >
      <UserNameWrapper>
        <ChatComponent />
      </UserNameWrapper>
    </LiveStoreProvider>
  )
}

export default App

const UserNameWrapper: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [uiState, setUiState] = useClientDocument(tables.uiState)
  const { store } = useStore()
  const newUserId = useRef(crypto.randomUUID())

  const joinChat = () => {
    if (!uiState.userContext?.username) return
    store.commit(
      events.userJoined({
        userId: uiState.userContext.userId,
        username: uiState.userContext.username,
        timestamp: new Date(),
      }),
    )
    setUiState({
      userContext: {
        username: uiState.userContext.username,
        userId: newUserId.current,
        hasJoined: true,
      },
    })
  }

  if (uiState.userContext === undefined || !uiState.userContext.hasJoined) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4 transition-colors">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 w-full max-w-md">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">💬 LiveStore Chat</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">Enter your username to join the chat:</p>
          <div className="space-y-4">
            <input
              data-testid="username"
              type="text"
              value={uiState.userContext?.username || ''}
              onChange={(e) =>
                setUiState({
                  userContext: {
                    username: e.target.value,
                    userId: newUserId.current,
                    hasJoined: false,
                  },
                })
              }
              placeholder="Your username..."
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              onKeyDown={(e) => e.key === 'Enter' && joinChat()}
            />
            <button
              type="button"
              data-testid="join-chat"
              onClick={joinChat}
              disabled={!uiState.userContext?.username}
              className={`w-full py-2 px-4 rounded-lg font-medium transition-colors ${
                uiState.userContext?.username
                  ? 'bg-blue-500 hover:bg-blue-600 text-white cursor-pointer'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              Join Chat
            </button>
          </div>
        </div>
      </div>
    )
  }

  return children
}

export const getStoreId = () => {
  if (typeof window === 'undefined') return 'unused'

  const searchParams = new URLSearchParams(window.location.search)
  const storeId = searchParams.get('storeId')
  if (storeId !== null) return storeId

  const newAppId = crypto.randomUUID()
  searchParams.set('storeId', newAppId)

  window.location.search = searchParams.toString()
}

const SyncStates = () => {
  const { store } = useStore()
  const [syncStates, setSyncStates] = useState<{ session: SyncState.SyncState; leader: SyncState.SyncState } | null>(
    null,
  )

  React.useEffect(() => {
    const interval = setInterval(() => {
      store._dev.syncStates().then(setSyncStates)
    }, 1000)
    return () => clearInterval(interval)
  }, [store])

  return (
    <div>
      <pre className="text-xs font-mono text-white">{JSON.stringify(syncStates, null, 2)}</pre>
    </div>
  )
}
