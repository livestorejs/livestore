// @ts-nocheck
/**
 * AI Agent Client-DO Example
 *
 * This example demonstrates how a client-do can be used to create a lightweight AI agent
 * that maintains conversation state, handles user interactions, and manages AI responses.
 * The DO acts as a stateful agent instance that persists conversation history and context.
 *
 * Architecture Overview:
 * ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
 * │   Web Client    │    │  Mobile App     │    │   API Client    │
 * │                 │    │                 │    │                 │
 * │ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
 * │ │ Chat UI     │ │    │ │ Chat UI     │ │    │ │ Bot Service │ │
 * │ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
 * └─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
 *           │                      │                      │
 *           │ HTTP/WebSocket       │ HTTP/WebSocket       │ HTTP/WebSocket
 *           │ POST /conversations  │ POST /chat           │ GET /agent/status
 *           │ POST /chat           │ GET /conversations   │ POST /agent/memory
 *           │ WS /websocket        │ WS /websocket        │ WS /websocket
 *           │                      │                      │
 *           └──────────────────────┼──────────────────────┘
 *                                  │
 *                                  ▼
 *                    ┌─────────────────────────────┐
 *                    │     Cloudflare Worker       │
 *                    │                             │
 *                    │  ┌───────────────────────┐  │
 *                    │  │   Request Router      │  │
 *                    │  │   /conversations  ────┼──┼─► Route to Agent Instance
 *                    │  │   /chat           ────┼──┼─► Route to Agent Instance
 *                    │  │   /agent/*        ────┼──┼─► Route to Agent Instance
 *                    │  │   /websocket      ────┼──┼─► Route to Sync Backend
 *                    │  └───────────────────────┘  │
 *                    └─────────────────────────────┘
 *                                  │
 *                                  │
 *        ┌─────────────────────────┼─────────────────────────┐
 *        │                         │                         │
 *        │                         │ events                  │
 *        │                         │ (push/pull)             │
 *        │                         │                         │
 *        ▼                         ▼                         ▼
 * ┌─────────────────────────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐
 * │        AI Agent Client-DO           │  │  Sync Backend    │  │     Other Agent          │
 * │                                     │◄═┤      DO          │═►│     Instances            │
 * │                                WebSocket              WebSocket                       │
 * │                             (live events)        (live events)                       │
 * │ ┌─────────────────────────────────┐ │  │                  │  │ ┌──────────────────────┐ │
 * │ │       LiveStore Schema          │ │  │ ┌──────────────┐ │  │ │ Agent #2             │ │
 * │ │                                 │ │  │ │ WebSocket    │ │  │ │ Agent #3             │ │
 * │ │ Tables:                         │ │  │ │ Management   │ │  │ │ ...                  │ │
 * │ │ • conversations                 │ │  │ │              │ │  │ └──────────────────────┘ │
 * │ │ • messages                      │ │  │ │ • Connection │ │  └──────────────────────────┘
 * │ │ • conversationMemory            │ │  │ │   pooling    │ │
 * │ │ • agentState                    │ │  │ │ • Message    │ │
 * │ │                                 │ │  │ │   routing    │ │
 * │ │ Events:                         │ │  │ │ • Event      │ │
 * │ │ • conversationCreated           │ │  │ │   broadcast  │ │
 * │ │ • messageAdded                  │ │  │ └──────────────┘ │
 * │ │ • memoryAdded                   │ │  │                  │
 * │ └─────────────────────────────────┘ │  │ ┌──────────────┐ │
 * │                                     │  │ │  D1 Database │ │
 * │ ┌─────────────────────────────────┐ │  │ │              │ │
 * │ │       Real-time Logic           │ │  │ │ • Event log  │ │
 * │ │                                 │ │  │ │ • Sync state │ │
 * │ │ • Message subscriptions         │ │  │ │ • Client     │ │
 * │ │ • Auto AI responses             │ │  │ │   sessions   │ │
 * │ │ • Memory management             │ │  │ └──────────────┘ │
 * │ │ • Conversation tracking         │ │  └──────────────────┘
 * │ │ • Sync integration              │ │           ▲
 * │ └─────────────────────────────────┘ │           │
 * └─────────────────────────────────────┘           │
 *          ▲                                │
 *          │                                │
 *          ▼                                ▼
 * ┌─────────────────────────────────────┐     ┌──────────────────┐
 * │       Agent DO Storage              │     │ Sync DO Storage  │
 * │                                     │     │                  │
 * │ • SQLite state database             │     │ • Event log      │
 * │ • Event log                         │     │ • WebSocket      │
 * │ • Conversation history              │     │   connections    │
 * │ • Agent memory                      │     │ • Sync metadata  │
 * │ • Cross-hibernation state           │     └──────────────────┘
 * └─────────────────────────────────────┘
 *
 * Key Features:
 * • Stateful AI agent with persistent conversation history
 * • Automatic AI response generation triggered by user messages
 * • Real-time subscriptions for immediate message processing
 * • Memory system for contextual conversations
 * • Hibernation-safe state management across requests
 * • RESTful API for multiple client types (web, mobile, API)
 */

import * as CfWorker from '@cloudflare/workers-types'
import { makeClientDurableObject } from '@livestore/adapter-cloudflare'
import { Events, makeSchema, Schema, SessionIdSymbol, State, type Store } from '@livestore/livestore'
import * as CfSyncBackend from '@livestore/sync-cf/cf-worker'
import { Effect } from '@livestore/utils/effect'

// Define SQLite tables for AI agent state
export const tables = {
  conversations: State.SQLite.table({
    name: 'conversations',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      userId: State.SQLite.text(),
      title: State.SQLite.text({ default: '' }),
      createdAt: State.SQLite.datetime(),
      updatedAt: State.SQLite.datetime(),
      personality: State.SQLite.text({ default: 'helpful and friendly' }),
      instructions: State.SQLite.text({ default: 'Be helpful and accurate' }),
      status: State.SQLite.text({ default: 'active' }), // 'active', 'paused', 'archived'
    },
  }),
  messages: State.SQLite.table({
    name: 'messages',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      conversationId: State.SQLite.text(),
      role: State.SQLite.text(), // 'user', 'assistant', 'system'
      content: State.SQLite.text(),
      timestamp: State.SQLite.datetime(),
      metadata: State.SQLite.text({ nullable: true }), // JSON string
    },
  }),
  conversationMemory: State.SQLite.table({
    name: 'conversationMemory',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      conversationId: State.SQLite.text(),
      fact: State.SQLite.text(),
      createdAt: State.SQLite.datetime(),
    },
  }),
  agentState: State.SQLite.clientDocument({
    name: 'agentState',
    schema: Schema.Struct({
      isThinking: Schema.Boolean,
      currentTask: Schema.NullOr(Schema.String),
      lastActivity: Schema.String,
      totalMessages: Schema.Number,
      activeConversations: Schema.Number,
    }),
    default: {
      id: SessionIdSymbol,
      value: {
        isThinking: false,
        currentTask: null,
        lastActivity: new Date().toISOString(),
        totalMessages: 0,
        activeConversations: 0,
      },
    },
  }),
}

// Define events for AI agent operations
export const events = {
  conversationCreated: Events.synced({
    name: 'v1.ConversationCreated',
    schema: Schema.Struct({
      id: Schema.String,
      userId: Schema.String,
      title: Schema.String,
      personality: Schema.String,
      instructions: Schema.String,
    }),
  }),
  messageAdded: Events.synced({
    name: 'v1.MessageAdded',
    schema: Schema.Struct({
      id: Schema.String,
      conversationId: Schema.String,
      role: Schema.Literal('user', 'assistant', 'system'),
      content: Schema.String,
      metadata: Schema.NullOr(Schema.String), // JSON string
    }),
  }),
  memoryAdded: Events.synced({
    name: 'v1.MemoryAdded',
    schema: Schema.Struct({
      id: Schema.String,
      conversationId: Schema.String,
      fact: Schema.String,
    }),
  }),
  conversationUpdated: Events.synced({
    name: 'v1.ConversationUpdated',
    schema: Schema.Struct({
      id: Schema.String,
      updatedAt: Schema.String,
      status: Schema.optional(Schema.Literal('active', 'paused', 'archived')),
    }),
  }),
  agentStateSet: tables.agentState.set, // Use auto-generated setter
}

// Map events to state changes
const materializers = State.SQLite.materializers(events, {
  'v1.ConversationCreated': ({ id, userId, title, personality, instructions }) =>
    tables.conversations.insert({
      id,
      userId,
      title,
      createdAt: new Date(),
      updatedAt: new Date(),
      personality,
      instructions,
      status: 'active',
    }),
  'v1.MessageAdded': ({ id, conversationId, role, content, metadata }) =>
    tables.messages.insert({
      id,
      conversationId,
      role,
      content,
      timestamp: new Date(),
      metadata,
    }),
  'v1.MemoryAdded': ({ id, conversationId, fact }) =>
    tables.conversationMemory.insert({
      id,
      conversationId,
      fact,
      createdAt: new Date(),
    }),
  'v1.ConversationUpdated': ({ id, updatedAt, status }) => {
    const update: { updatedAt: Date; status?: string } = { updatedAt: new Date(updatedAt) }
    if (status) update.status = status
    return tables.conversations.update(update).where({ id })
  },
})

const state = State.SQLite.makeState({ tables, materializers })
export const schema = makeSchema({ events, state })

type AIAgentSchema = typeof schema

// Create the AI Agent Client-DO class
export class AIAgentClientDO extends makeClientDurableObject({
  schema,
  clientId: 'ai-agent',
  sessionId: 'agent-session',

  // Initialize agent state and register queries
  registerQueries: (store) => [
    // Subscribe to new user messages to trigger AI responses
    store.subscribe(tables.messages.where({ role: 'user' }).orderBy('timestamp', 'desc'), {
      onUpdate: (userMessages) => {
        // Get the latest user message (first in desc order)
        const latestUserMessage = userMessages[0]

        if (latestUserMessage) {
          // Check if we already have an assistant response for this conversation after this message
          const assistantMessages = store.query(
            tables.messages.where({
              conversationId: latestUserMessage.conversationId,
              role: 'assistant',
              timestamp: { op: '>', value: latestUserMessage.timestamp },
            }),
          )

          if (assistantMessages.length === 0) {
            // Trigger AI response generation
            generateAIResponse(store, latestUserMessage.conversationId, latestUserMessage)
          }
        }
      },
      label: 'user-message-watcher',
    }),

    // Subscribe to conversation updates to maintain agent statistics
    store.subscribe(tables.conversations.where({ status: 'active' }), {
      onUpdate: (activeConversations) => {
        const currentState = store.query(tables.agentState)[0]?.value
        if (currentState) {
          store.commit(
            events.agentStateSet({
              ...currentState,
              activeConversations: activeConversations.length,
              lastActivity: new Date().toISOString(),
            }),
          )
        }
      },
      label: 'active-conversations-monitor',
    }),

    // Subscribe to agent state changes for monitoring
    store.subscribe(tables.agentState, {
      onUpdate: (stateRows) => {
        const state = stateRows[0]?.value
        if (state) {
          console.log(
            `Agent state updated: ${state.activeConversations} active conversations, ${state.totalMessages} total messages`,
          )
        }
      },
      label: 'agent-state-monitor',
    }),
  ],

  // Handle custom endpoints for AI agent operations
  handleCustomRequest: (request, ensureStore) =>
    Effect.gen(function* () {
      const url = new URL(request.url)
      const store = yield* ensureStore

      switch (url.pathname) {
        case '/conversations':
          if (request.method === 'POST') {
            return yield* createNewConversation(store, request)
          }
          return getAllConversations(store)

        case '/chat':
          if (request.method === 'POST') {
            return yield* sendMessage(store, request)
          }
          break

        case '/agent/status':
          return getAgentStatus(store)

        case '/agent/memory':
          if (request.method === 'POST') {
            return yield* updateAgentMemory(store, request)
          }
          break
      }

      return null // Let default handler process
    }),
}) {}

// =============================================================================
// SYNC BACKEND IMPLEMENTATION
// =============================================================================

// Environment type definition for both DOs
export type Env = {
  CLIENT_DO: CfWorker.DurableObjectNamespace
  SYNC_BACKEND_DO: CfWorker.DurableObjectNamespace
  DB: CfWorker.D1Database
  ADMIN_SECRET: string
}

// Sync Backend Durable Object
export class AIAgentSyncBackendDO extends CfSyncBackend.makeDurableObject({
  onPush: async (message, context) => {
    console.log(`[Sync Backend] Push: ${message.batch.length} events for storeId: ${context.storeId}`)
    // Optional: Add custom logic for handling pushed events
    // e.g., notifications, external integrations, analytics
  },
  onPull: async (_message, context) => {
    console.log(`[Sync Backend] Pull request for storeId: ${context.storeId}`)
    // Optional: Add custom logic for pull requests
    // e.g., access control, rate limiting, audit logging
  },
}) {}

// Example Worker Implementation with Routing
export const worker = {
  fetch: async (request: CfWorker.Request, env: Env, _ctx: CfWorker.ExecutionContext): Promise<CfWorker.Response> => {
    const url = new URL(request.url)

    // Route WebSocket connections to sync backend
    if (url.pathname === '/websocket') {
      // Handle WebSocket upgrade for sync backend
      const syncBackendId = env.SYNC_BACKEND_DO.idFromName('sync-backend')
      const syncBackendStub = env.SYNC_BACKEND_DO.get(syncBackendId)
      return syncBackendStub.fetch(request)
    }

    // Route to AI agent client DO
    const storeId = url.searchParams.get('storeId') ?? 'default-agent'
    const clientId = env.CLIENT_DO.idFromName(storeId)
    const clientStub = env.CLIENT_DO.get(clientId)

    return clientStub.fetch(request)
  },
} satisfies CfWorker.ExportedHandler<Env>

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// AI Response generation (simulated)
function generateAIResponse(
  store: Store<typeof schema>,
  conversationId: string,
  userMessage: {
    id: string
    conversationId: string
    role: string
    content: string
    timestamp: Date
    metadata: string | null
  },
) {
  // Update agent state to show thinking
  const currentState = store.query(tables.agentState)[0]?.value ?? {
    isThinking: false,
    currentTask: null,
    lastActivity: new Date().toISOString(),
    totalMessages: 0,
    activeConversations: 0,
  }
  store.commit(
    events.agentStateSet({
      isThinking: true,
      currentTask: `Responding to: ${userMessage.content.slice(0, 50)}...`,
      lastActivity: new Date().toISOString(),
      totalMessages: currentState.totalMessages,
      activeConversations: currentState.activeConversations,
    }),
  )

  // Simulate AI processing delay
  setTimeout(
    () => {
      const conversation = store.query(tables.conversations.where({ id: conversationId }).first({ behaviour: 'error' }))
      const conversationMemory = store.query(tables.conversationMemory.where({ conversationId }))

      // Generate response based on conversation context
      const aiResponse = simulateAIGeneration(conversation, userMessage, conversationMemory)

      // Add AI response to conversation
      store.commit(
        events.messageAdded({
          id: crypto.randomUUID(),
          conversationId,
          role: 'assistant' as const,
          content: aiResponse,
          metadata: JSON.stringify({
            model: 'claude-3-sonnet',
            tokens: aiResponse.length,
          }),
        }),
      )

      // Update conversation metadata
      store.commit(
        events.conversationUpdated({
          id: conversationId,
          updatedAt: new Date().toISOString(),
        }),
      )

      // Update agent state
      const currentState = store.query(tables.agentState)[0]?.value ?? {
        isThinking: false,
        currentTask: null,
        lastActivity: new Date().toISOString(),
        totalMessages: 0,
        activeConversations: 0,
      }
      store.commit(
        events.agentStateSet({
          isThinking: false,
          currentTask: null,
          lastActivity: new Date().toISOString(),
          totalMessages: currentState.totalMessages + 1,
          activeConversations: currentState.activeConversations,
        }),
      )
    },
    1000 + Math.random() * 2000,
  ) // 1-3 second response time
}

// Simulate AI text generation
function simulateAIGeneration(
  _conversation: { id: string; userId: string; title: string; personality: string; instructions: string },
  userMessage: { content: string },
  memory: ReadonlyArray<{ fact: string }>,
): string {
  const responses = [
    "That's an interesting question! Let me think about that...",
    "Based on our conversation history, I can see that you're interested in...",
    "I understand what you're asking. Here's my perspective:",
    'That reminds me of something we discussed earlier. Let me elaborate...',
    "I can help with that! Here's what I recommend:",
  ]

  let response =
    responses[Math.floor(Math.random() * responses.length)] +
    ` (Responding to: "${userMessage.content.slice(0, 30)}...")`

  // Add context from memory if available
  if (memory.length > 0) {
    response += ` I remember that ${memory[Math.floor(Math.random() * memory.length)]!.fact}.`
  }

  return response
}

// API endpoint handlers
function createNewConversation(store: Store<typeof schema>, request: CfWorker.Request) {
  return Effect.gen(function* () {
    const body = yield* Effect.promise(() => request.json()) as Effect.Effect<
      {
        userId: string
        title?: string
        personality?: string
        instructions?: string
      },
      never,
      never
    >
    const { userId, title, personality, instructions } = body

    const conversationId = crypto.randomUUID()

    // Create new conversation
    store.commit(
      events.conversationCreated({
        id: conversationId,
        userId,
        title: title || 'New Conversation',
        personality: personality || 'helpful and friendly',
        instructions: instructions || 'Be helpful and accurate',
      }),
    )

    // Update agent state
    const currentState = store.query(tables.agentState)[0]?.value ?? {
      isThinking: false,
      currentTask: null,
      lastActivity: new Date().toISOString(),
      totalMessages: 0,
      activeConversations: 0,
    }
    store.commit(
      events.agentStateSet({
        ...currentState,
        activeConversations: currentState.activeConversations + 1,
        lastActivity: new Date().toISOString(),
      }),
    )

    const conversation = store.query(tables.conversations.where({ id: conversationId }).first({ behaviour: 'error' }))
    return new CfWorker.Response(JSON.stringify({ conversationId, conversation }), {
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

function sendMessage(store: Store<typeof schema>, request: CfWorker.Request) {
  return Effect.gen(function* () {
    const body = yield* Effect.promise(() => request.json()) as Effect.Effect<
      {
        conversationId: string
        content: string
        role?: 'user' | 'assistant' | 'system'
      },
      never,
      never
    >
    const { conversationId, content, role = 'user' } = body

    const messageId = crypto.randomUUID()

    // Add message to conversation
    store.commit(
      events.messageAdded({
        id: messageId,
        conversationId,
        role,
        content,
        metadata: null,
      }),
    )

    // Update conversation timestamp
    store.commit(
      events.conversationUpdated({
        id: conversationId,
        updatedAt: new Date().toISOString(),
      }),
    )

    // Update agent state if user message
    if (role === 'user') {
      const currentState = store.query(tables.agentState)[0]?.value ?? {
        isThinking: false,
        currentTask: null,
        lastActivity: new Date().toISOString(),
        totalMessages: 0,
        activeConversations: 0,
      }
      store.commit(
        events.agentStateSet({
          ...currentState,
          totalMessages: currentState.totalMessages + 1,
          lastActivity: new Date().toISOString(),
        }),
      )
    }

    const message = store.query(tables.messages.where({ id: messageId }).first({ behaviour: 'error' }))
    return new CfWorker.Response(JSON.stringify({ success: true, message }), {
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

function getAllConversations(store: Store<typeof schema>): CfWorker.Response {
  // Get all conversations ordered by most recently updated
  const conversations = store.query(tables.conversations.orderBy('updatedAt', 'desc'))

  // Get message counts for each conversation
  const conversationsWithCounts = conversations.map((conv) => {
    const messageCount = store.query(tables.messages.where({ conversationId: conv.id })).length
    const lastMessage = store.query(
      tables.messages.where({ conversationId: conv.id }).orderBy('timestamp', 'desc').first(),
    )

    return {
      ...conv,
      messageCount,
      lastMessage: lastMessage?.content || null,
      lastMessageTime: lastMessage?.timestamp || null,
    }
  })

  return new CfWorker.Response(JSON.stringify({ conversations: conversationsWithCounts }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

function getAgentStatus(store: Store<typeof schema>): CfWorker.Response {
  const agentState = store.query(tables.agentState)[0]?.value ?? {
    isThinking: false,
    currentTask: null,
    lastActivity: new Date().toISOString(),
    totalMessages: 0,
    activeConversations: 0,
  }

  // Get detailed statistics using query builder
  const activeConversations = store.query(tables.conversations.where({ status: 'active' }))
  const allConversations = store.query(tables.conversations)
  const allMessages = store.query(tables.messages)
  const memoryEntries = store.query(tables.conversationMemory)

  // Get recent activity
  const recentMessages = store.query(tables.messages.orderBy('timestamp', 'desc').limit(5))
  const recentConversations = store.query(tables.conversations.orderBy('updatedAt', 'desc').limit(3))

  return new CfWorker.Response(
    JSON.stringify({
      ...agentState,
      statistics: {
        activeConversations: activeConversations.length,
        totalConversations: allConversations.length,
        totalMessages: allMessages.length,
        memoryEntries: memoryEntries.length,
        avgMessagesPerConversation:
          allConversations.length > 0 ? Math.round(allMessages.length / allConversations.length) : 0,
      },
      recentActivity: {
        recentMessages: recentMessages.map((msg) => ({
          id: msg.id,
          conversationId: msg.conversationId,
          role: msg.role,
          timestamp: msg.timestamp,
          preview: msg.content.slice(0, 50) + (msg.content.length > 50 ? '...' : ''),
        })),
        recentConversations: recentConversations.map((conv) => ({
          id: conv.id,
          title: conv.title,
          updatedAt: conv.updatedAt,
          status: conv.status,
        })),
      },
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

function updateAgentMemory(store: Store<typeof schema>, request: CfWorker.Request) {
  return Effect.gen(function* () {
    const body = yield* Effect.promise(() => request.json()) as Effect.Effect<
      {
        conversationId: string
        facts: string[]
      },
      never,
      never
    >
    const { conversationId, facts } = body

    // Verify conversation exists
    const conversation = store.query(tables.conversations.where({ id: conversationId }).first())
    if (!conversation) {
      return new CfWorker.Response(JSON.stringify({ error: 'Conversation not found' }), { status: 404 })
    }

    if (Array.isArray(facts)) {
      // Add each fact as a memory entry
      for (const fact of facts) {
        store.commit(
          events.memoryAdded({
            id: crypto.randomUUID(),
            conversationId,
            fact,
          }),
        )
      }
    }

    // Get updated memory count for this conversation
    const memoryCount = store.query(tables.conversationMemory.where({ conversationId })).length

    return new CfWorker.Response(
      JSON.stringify({
        success: true,
        factsAdded: facts.length,
        totalMemoryEntries: memoryCount,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      },
    )
  })
}

// Additional helper function showcasing advanced query builder usage
function _getConversationAnalytics(store: Store<typeof schema>, conversationId: string) {
  // Get conversation with detailed analytics
  const conversation = store.query(tables.conversations.where({ id: conversationId }).first())
  if (!conversation) return null

  // Advanced queries using the query builder
  const messages = store.query(tables.messages.where({ conversationId }))
  const userMessages = store.query(tables.messages.where({ conversationId, role: 'user' }))
  const assistantMessages = store.query(tables.messages.where({ conversationId, role: 'assistant' }))
  const memoryEntries = store.query(tables.conversationMemory.where({ conversationId }))

  // Get recent messages with limit and ordering
  const recentMessages = store.query(tables.messages.where({ conversationId }).orderBy('timestamp', 'desc').limit(10))

  // Get message frequency by time periods
  const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const recentMessages24h = store.query(
    tables.messages.where({
      conversationId,
      timestamp: { op: '>=', value: last24Hours },
    }),
  )

  return {
    conversation,
    analytics: {
      totalMessages: messages.length,
      userMessages: userMessages.length,
      assistantMessages: assistantMessages.length,
      memoryEntries: memoryEntries.length,
      averageResponseTime: calculateAverageResponseTime(messages),
      messagesLast24h: recentMessages24h.length,
      conversationLength: calculateConversationDuration(messages),
    },
    recentActivity: recentMessages,
  }
}

// Helper function for response time calculation
function calculateAverageResponseTime(messages: ReadonlyArray<{ role: string; timestamp: Date }>): number {
  const pairs: number[] = []
  for (let i = 0; i < messages.length - 1; i++) {
    const current = messages[i]
    const next = messages[i + 1]
    if (current && next && current.role === 'user' && next.role === 'assistant') {
      const responseTime = next.timestamp.getTime() - current.timestamp.getTime()
      pairs.push(responseTime)
    }
  }
  return pairs.length > 0 ? pairs.reduce((a, b) => a + b, 0) / pairs.length : 0
}

// Helper function for conversation duration
function calculateConversationDuration(messages: ReadonlyArray<{ timestamp: Date }>): number {
  if (messages.length < 2) return 0
  const first = messages[0]?.timestamp
  const last = messages[messages.length - 1]?.timestamp
  if (!first || !last) return 0
  return Math.abs(last.getTime() - first.getTime())
}

// Export event types for TypeScript users
export type ConversationCreatedEvent = typeof events.conversationCreated.schema.Type
export type MessageAddedEvent = typeof events.messageAdded.schema.Type
export type MemoryAddedEvent = typeof events.memoryAdded.schema.Type
export type ConversationUpdatedEvent = typeof events.conversationUpdated.schema.Type

/**
 * Configuration & Usage:
 *
 * 1. wrangler.toml setup:
 *    ```toml
 *    [[durable_objects.bindings]]
 *    name = "CLIENT_DO"
 *    class_name = "AIAgentClientDO"
 *
 *    [[durable_objects.bindings]]
 *    name = "SYNC_BACKEND_DO"
 *    class_name = "AIAgentSyncBackendDO"
 *
 *    [[d1_databases]]
 *    binding = "DB"
 *    database_name = "ai-agent-sync"
 *    database_id = "your-d1-database-id"
 *
 *    [vars]
 *    ADMIN_SECRET = "your-admin-secret"
 *    ```
 *
 * 2. API Usage Examples:
 *
 *    Create a new conversation:
 *    POST /conversations?storeId=agent-123
 *    { "userId": "user-123", "title": "Code Review Session", "personality": "technical expert" }
 *
 *    Send a message:
 *    POST /chat?storeId=agent-123
 *    { "conversationId": "conv-456", "content": "Can you review this code?", "role": "user" }
 *
 *    Check agent status:
 *    GET /agent/status?storeId=agent-123
 *
 *    Update agent memory:
 *    POST /agent/memory?storeId=agent-123
 *    { "conversationId": "conv-456", "facts": ["User prefers TypeScript", "Likes concise explanations"] }
 *
 *    Get all conversations:
 *    GET /conversations?storeId=agent-123
 *
 * 3. WebSocket Connection (for real-time sync):
 *    const ws = new WebSocket('wss://your-worker.your-subdomain.workers.dev/websocket')
 *    ws.onmessage = (event) => {
 *      const syncMessage = JSON.parse(event.data)
 *      // Handle real-time state updates
 *    }
 *
 * 4. Multiple Agent Instances:
 *    Each storeId creates a separate AI agent instance:
 *    - /conversations?storeId=customer-support-bot
 *    - /conversations?storeId=technical-help-bot
 *    - /conversations?storeId=sales-assistant-bot
 *
 * Key Features with Sync Backend:
 * • Multi-client synchronization across web, mobile, and API clients
 * • Real-time state updates via WebSocket connections
 * • Persistent event log in D1 database for reliable sync
 * • Hibernation-safe state management across both DOs
 * • Automatic conflict resolution and event ordering
 * • Scalable architecture supporting multiple AI agent instances
 * • Cross-instance communication and shared state capabilities
 *
 * Architecture Benefits:
 * • Client-DO: Handles business logic, AI responses, and user interactions
 * • Sync-DO: Manages real-time synchronization and multi-client state
 * • Separation of concerns enables independent scaling and maintenance
 * • LiveStore provides consistent state management across both layers
 */
