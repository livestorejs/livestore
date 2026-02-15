/// <reference types="vite/client" />

import { StoreRegistry } from '@livestore/livestore'
import { StoreRegistryProvider } from '@livestore/react'
import React, { Suspense, useCallback, useMemo, useRef, useState } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { VersionBadge } from './components/VersionBadge.tsx'
import { ChatHeader, MessageInput, MessagesContainer, UserSidebar } from './components.tsx'
import { useChat } from './hooks.ts'
import { events, tables } from './livestore/schema.ts'
import { useAppStore } from './livestore/store.ts'

// Main chat component that uses LiveStore hooks
export const ChatComponent = () => {
  const store = useAppStore()
  const chatHook = useChat()

  React.useEffect(() => {
    fetch(`/client-do?storeId=${store.storeId}`)
      .then((res) => res.json())
      .then((data) => {
        console.log('do state', data)
      })
  }, [store.storeId])

  React.useEffect(() => {
    document.title = `LiveChat - Room ${store.storeId}`
  }, [store.storeId])

  return (
    <div className="flex h-screen max-w-6xl lg:mx-0 mx-auto transition-colors bg-slate-900">
      <UserSidebar otherUsers={chatHook.otherUsers} userContext={chatHook.userContext} />

      <div className="flex-1 flex flex-col p-3 md:p-6 lg:p-8 max-w-4xl lg:mx-0 mx-auto w-full">
        <ChatHeader userContext={chatHook.userContext} otherUsers={chatHook.otherUsers} roomName={store.storeId} />

        <MessagesContainer
          messages={chatHook.messages}
          messagesEndRef={chatHook.messagesEndRef}
          userContext={chatHook.userContext}
          getReactionsForMessage={chatHook.getReactionsForMessage}
          getReadReceiptsForMessage={chatHook.getReadReceiptsForMessage}
          removeReaction={chatHook.removeReaction}
          showReactionPicker={chatHook.showReactionPicker}
          toggleReactionPicker={chatHook.toggleReactionPicker}
          addReaction={chatHook.addReaction}
          setShowReactionPicker={chatHook.setShowReactionPicker}
        />

        <div className="mt-auto pt-2 border-t border-transparent">
          <MessageInput
            currentMessage={chatHook.currentMessage}
            setCurrentMessage={chatHook.setCurrentMessage}
            sendMessage={chatHook.sendMessage}
          />
        </div>
      </div>
    </div>
  )
}

const chatErrorFallback = <div>Something went wrong</div>
const chatLoadingFallback = <div>Loading...</div>

// App component with LiveStore provider - exported as ChatApp for main.tsx
export const ChatApp = () => {
  const [storeRegistry] = useState(() => new StoreRegistry())

  return (
    <ErrorBoundary fallback={chatErrorFallback}>
      <Suspense fallback={chatLoadingFallback}>
        <StoreRegistryProvider storeRegistry={storeRegistry}>
          <UserNameWrapper>
            <ChatComponent />
          </UserNameWrapper>
          <VersionBadge />
        </StoreRegistryProvider>
      </Suspense>
    </ErrorBoundary>
  )
}

export default ChatApp

const UserNameWrapper: React.FC<React.PropsWithChildren> = ({ children }) => {
  const store = useAppStore()
  const [uiState, setUiState] = store.useClientDocument(tables.uiState)
  const newUserId = useRef(crypto.randomUUID())

  const joinChat = useCallback(() => {
    if (!uiState.userContext?.username) return
    const avatar = pickAvatar(uiState.userContext.avatarEmoji, uiState.userContext.avatarColor)
    store.commit(
      events.userJoined({
        userId: uiState.userContext.userId,
        username: uiState.userContext.username,
        avatarEmoji: avatar.emoji,
        avatarColor: avatar.color,
        timestamp: new Date(),
      }),
    )
    setUiState({
      userContext: {
        username: uiState.userContext.username,
        userId: newUserId.current,
        hasJoined: true,
        avatarEmoji: avatar.emoji,
        avatarColor: avatar.color,
      },
    })
  }, [setUiState, store, uiState.userContext])

  const handleUsernameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setUiState({
        userContext: {
          username: e.target.value,
          userId: newUserId.current,
          hasJoined: false,
          avatarEmoji: uiState.userContext?.avatarEmoji,
          avatarColor: uiState.userContext?.avatarColor,
        },
      })
    },
    [setUiState, uiState.userContext?.avatarColor, uiState.userContext?.avatarEmoji],
  )

  const handleUsernameKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        joinChat()
      }
    },
    [joinChat],
  )

  const avatarPickerValue = useMemo(
    () => ({
      emoji: uiState.userContext?.avatarEmoji,
      color: uiState.userContext?.avatarColor,
    }),
    [uiState.userContext?.avatarColor, uiState.userContext?.avatarEmoji],
  )

  const handleAvatarChange = useCallback(
    (val: { emoji: string; color: string }) => {
      setUiState({
        userContext: {
          username: uiState.userContext?.username ?? '',
          userId: newUserId.current,
          hasJoined: false,
          avatarEmoji: val.emoji,
          avatarColor: val.color,
        },
      })
    },
    [setUiState, uiState.userContext?.username],
  )

  if (uiState.userContext === undefined || !uiState.userContext.hasJoined) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4 transition-colors">
        <div className="bg-gray-800 rounded-lg shadow-lg p-6 lg:p-8 w-full max-w-md lg:max-w-lg">
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-100 mb-2 lg:mb-4">💬 LiveChat</h1>
          <p className="text-gray-400 mb-6 lg:mb-8 lg:text-lg">Enter your username to join the chat:</p>
          <div className="space-y-4">
            <input
              data-testid="username"
              type="text"
              value={uiState.userContext?.username || ''}
              onChange={handleUsernameChange}
              placeholder="Your username..."
              className="w-full px-4 py-2 lg:px-5 lg:py-3 border border-gray-600 bg-gray-700 text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base lg:text-lg"
              onKeyDown={handleUsernameKeyDown}
            />
            <div className="flex items-center gap-3">
              <AvatarPicker value={avatarPickerValue} onChange={handleAvatarChange} />
            </div>
            <button
              type="button"
              data-testid="join-chat"
              onClick={joinChat}
              disabled={!uiState.userContext?.username}
              className={`w-full py-2 px-4 lg:py-3 lg:px-5 rounded-lg font-medium transition-colors text-base lg:text-lg ${
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

const avatarOptions: { emoji: string; color: string }[] = [
  { emoji: '🙂', color: '#60a5fa' }, // blue
  { emoji: '😄', color: '#34d399' }, // green
  { emoji: '😎', color: '#0ea5e9' }, // sky
  { emoji: '🤠', color: '#f59e0b' }, // amber
  { emoji: '🧑‍🚀', color: '#a78bfa' }, // violet
  { emoji: '🧑‍💻', color: '#f472b6' }, // pink
  { emoji: '🦊', color: '#f97316' }, // orange
  { emoji: '🐼', color: '#64748b' }, // slate
  { emoji: '🐧', color: '#06b6d4' }, // cyan
  { emoji: '🐸', color: '#84cc16' }, // lime
]

const avatarOptionStyles = avatarOptions.map((option) => ({ backgroundColor: option.color }))

const pickAvatar = (existingEmoji?: string, existingColor?: string) => {
  if (existingEmoji !== undefined && existingColor !== undefined) return { emoji: existingEmoji, color: existingColor }
  const idx = Math.floor(Math.random() * avatarOptions.length)
  return avatarOptions[idx]
}

const AvatarPicker = ({
  value,
  onChange,
}: {
  value?: { emoji?: string; color?: string }
  onChange: (v: { emoji: string; color: string }) => void
}) => {
  const [internalIndex, setInternalIndex] = React.useState<number>(() =>
    Math.floor(Math.random() * avatarOptions.length),
  )

  const isControlled = value?.emoji !== undefined && value?.color !== undefined

  const controlledIndex = (() => {
    if (isControlled) {
      const idx = avatarOptions.findIndex((o) => o.emoji === value!.emoji && o.color === value!.color)
      if (idx !== -1) return idx
    }
    return undefined
  })()

  const selectedIndex = controlledIndex ?? internalIndex

  const handleAvatarOptionClick = React.useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const index = Number(e.currentTarget.dataset.avatarIndex)
      const option = avatarOptions[index]
      if (option === undefined) return
      if (isControlled) {
        onChange({ emoji: option.emoji, color: option.color })
      } else {
        setInternalIndex(index)
      }
    },
    [isControlled, onChange],
  )

  React.useEffect(() => {
    if (!isControlled) {
      const opt = avatarOptions[selectedIndex]
      onChange({ emoji: opt.emoji, color: opt.color })
    }
  }, [selectedIndex, isControlled, onChange])

  return (
    <div className="grid grid-cols-5 sm:grid-cols-6 gap-3">
      {avatarOptions.map((opt, idx) => (
        <button
          key={`${opt.emoji}-${opt.color}`}
          type="button"
          data-avatar-index={idx}
          onClick={handleAvatarOptionClick}
          className={`w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center text-xl md:text-2xl border transition-all duration-150 ${
            selectedIndex === idx
              ? 'ring-2 md:ring-3 ring-blue-400 shadow-lg opacity-100 scale-105 border-transparent'
              : 'opacity-70 hover:opacity-100 hover:scale-105 border-transparent'
          }`}
          style={avatarOptionStyles[idx]}
          aria-label={`Choose avatar ${opt.emoji}`}
        >
          <span>{opt.emoji}</span>
        </button>
      ))}
    </div>
  )
}
