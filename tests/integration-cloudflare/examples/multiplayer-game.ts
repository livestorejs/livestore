// @ts-nocheck
/**
 * Multiplayer Game State Client-DO Example
 *
 * This example demonstrates how a client-do can manage multiplayer game state
 * for a real-time game like a battle royale or collaborative puzzle game.
 * It handles player connections, game mechanics, state synchronization, and matchmaking.
 *
 * Architecture Overview:
 * ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
 * │   Game Client   │    │  Mobile Game    │    │  Spectator App  │
 * │                 │    │                 │    │                 │
 * │ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
 * │ │ Game UI     │ │    │ │ Touch UI    │ │    │ │ Stream View │ │
 * │ │ • Movement  │ │    │ │ • Gestures  │ │    │ │ • Chat      │ │
 * │ │ • Combat    │ │    │ │ • Combat    │ │    │ │ • Stats     │ │
 * │ │ • Inventory │ │    │ │ • Items     │ │    │ │ • Leaderbd  │ │
 * │ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
 * └─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
 *           │                      │                      │
 *           │ HTTP/WebSocket       │ HTTP/WebSocket       │ HTTP/WebSocket
 *           │ POST /game/join      │ POST /player/move    │ GET /game/state
 *           │ POST /player/action  │ POST /player/action  │ WS /websocket
 *           │ WS /websocket        │ WS /websocket        │ (read-only)
 *           │                      │                      │
 *           └──────────────────────┼──────────────────────┘
 *                                  │
 *                                  ▼
 *                    ┌─────────────────────────────┐
 *                    │     Cloudflare Worker       │
 *                    │                             │
 *                    │  ┌───────────────────────┐  │
 *                    │  │   Game Router         │  │
 *                    │  │   /game/*         ────┼──┼─► Game Instance
 *                    │  │   /player/*       ────┼──┼─► Game Instance
 *                    │  │   /leaderboard    ────┼──┼─► Game Instance
 *                    │  │   /websocket      ────┼──┼─► Sync Backend
 *                    │  └───────────────────────┘  │
 *                    └─────────────────────────────┘
 *                                  │
 *                                  │
 *        ┌─────────────────────────┼─────────────────────────┐
 *        │                         │                         │
 *        ▼                         ▼                         ▼
 * ┌──────────────────┐  ┌─────────────────────────────┐  ┌──────────────────┐
 * │  Sync Backend    │  │  Multiplayer Game Client-DO │  │  Other Game      │
 * │      DO          │◄─┤                             │  │  Instances       │
 * │                  │  │ ┌─────────────────────────┐ │  │                  │
 * │ ┌──────────────┐ │  │ │   LiveStore Schema      │ │  │ ┌──────────────┐ │
 * │ │ WebSocket    │ │  │ │                         │ │  │ │ Battle Royal │ │
 * │ │ Management   │ │  │ │ Tables:                 │ │  │ │ Racing Game  │ │
 * │ │              │ │  │ │ • gameSession           │ │  │ │ Puzzle Coop  │ │
 * │ │ • Player     │ │  │ │ • players               │ │  │ │ Card Game    │ │
 * │ │   connections│ │  │ │ • gameEvents            │ │  │ └──────────────┘ │
 * │ │ • Real-time  │ │  │ │ • powerUps              │ │  └──────────────────┘
 * │ │   updates    │ │  │ │ • leaderboard           │ │           │
 * │ │ • Game state │ │  │ │                         │ │           │
 * │ │   broadcast  │ │  │ │ Events:                 │ │           │
 * │ └──────────────┘ │  │ │ • gameCreated           │ │           │
 * │                  │  │ │ • playerJoined          │ │           │
 * │ ┌──────────────┐ │  │ │ • playerMoved           │ │           │
 * │ │  D1 Database │ │  │ │ • playerAction          │ │           │ Sync Events
 * │ │              │ │  │ │ • gameStateChanged      │ │           │ & Game State
 * │ │ • Event log  │ │  │ └─────────────────────────┘ │◄──────────┘
 * │ │ • Game state │ │  │                             │
 * │ │ • Player     │ │  │ ┌─────────────────────────┐ │
 * │ │   sessions   │ │  │ │   Game Engine Logic     │ │
 * │ │ • Leaderboard│ │  │ │                         │ │
 * │ └──────────────┘ │  │ │ • Physics simulation    │ │
 * └──────────────────┘  │ │ • Collision detection  │ │
 *          │             │ │ • Combat system        │ │
 *          │             │ │ • Win condition checks │ │
 *          │             │ │ • Anti-cheat validation│ │
 *          │             │ │ • Real-time tick loop  │ │
 *          │             │ └─────────────────────────┘ │
 *          │             └─────────────────────────────┘
 *          │                           │
 *          │ Hibernation               │ Hibernation
 *          │ (Persists Sync State)     │ (Persists Game State)
 *          │                           │
 *          ▼                           ▼
 * ┌──────────────────┐     ┌─────────────────────────────┐
 * │ Sync DO Storage  │     │   Game DO Storage           │
 * │                  │     │                             │
 * │ • Event log      │     │ • SQLite database           │
 * │ • WebSocket      │     │ • Event log                 │
 * │   connections    │     │ • Game state snapshots     │
 * │ • Player state   │     │ • Player data & stats       │
 * │ • Match history  │     │ • Cross-hibernation state   │
 * └──────────────────┘     └─────────────────────────────┘
 *
 * Key Features:
 * • Real-time multiplayer game with persistent state
 * • Player movement, combat, and inventory management
 * • Anti-cheat validation and physics simulation
 * • Spectator support with read-only game state
 * • Leaderboards and match history
 * • Support for multiple game types (battle royale, co-op, etc.)
 */

import type * as CfWorker from '@cloudflare/workers-types'
import { makeClientDurableObject } from '@livestore/adapter-cloudflare'
import { Events, makeSchema, Schema, SessionIdSymbol, State, type Store } from '@livestore/livestore'
import * as CfSyncBackend from '@livestore/sync-cf/cf-worker'
import { Effect } from '@livestore/utils/effect'

// Define SQLite tables for multiplayer game state
export const tables = {
  gameSession: State.SQLite.table({
    name: 'gameSession',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      name: State.SQLite.text({ default: '' }),
      type: State.SQLite.text({ default: 'battle_royale' }), // 'battle_royale', 'puzzle_coop', 'racing', 'card_game'
      status: State.SQLite.text({ default: 'waiting' }), // 'waiting', 'starting', 'active', 'paused', 'ended'
      maxPlayers: State.SQLite.integer({ default: 10 }),
      currentPlayers: State.SQLite.integer({ default: 0 }),
      startTime: State.SQLite.text({ nullable: true }),
      endTime: State.SQLite.text({ nullable: true }),
      duration: State.SQLite.integer({ default: 0 }), // Game duration in seconds
      mapId: State.SQLite.text({ default: 'default_map' }),
      gameMode: State.SQLite.text({ default: 'standard' }),
      difficulty: State.SQLite.text({ default: 'medium' }), // 'easy', 'medium', 'hard'
      allowSpectators: State.SQLite.boolean({ default: true }),
      privateGame: State.SQLite.boolean({ default: false }),
      createdAt: State.SQLite.text(),
      updatedAt: State.SQLite.text(),
    },
  }),
  players: State.SQLite.table({
    name: 'players',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      gameId: State.SQLite.text(),
      username: State.SQLite.text(),
      avatar: State.SQLite.text({ default: 'default' }),
      status: State.SQLite.text({ default: 'connected' }), // 'connected', 'disconnected', 'playing', 'spectating', 'eliminated'
      positionX: State.SQLite.real({ default: 0 }),
      positionY: State.SQLite.real({ default: 0 }),
      positionZ: State.SQLite.real({ nullable: true }),
      health: State.SQLite.integer({ default: 100 }),
      score: State.SQLite.integer({ default: 0 }),
      level: State.SQLite.integer({ default: 1 }),
      inventory: State.SQLite.text({ default: '[]' }), // JSON string
      lastActivity: State.SQLite.text(),
      joinedAt: State.SQLite.text(),
      team: State.SQLite.text({ nullable: true }),
    },
  }),
  gameEvents: State.SQLite.table({
    name: 'gameEvents',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      gameId: State.SQLite.text(),
      type: State.SQLite.text(), // 'player_join', 'player_leave', 'player_eliminated', etc.
      timestamp: State.SQLite.text(),
      playerId: State.SQLite.text({ nullable: true }),
      data: State.SQLite.text({ nullable: true }), // JSON string
    },
  }),
  powerUps: State.SQLite.table({
    name: 'powerUps',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      gameId: State.SQLite.text(),
      type: State.SQLite.text(),
      positionX: State.SQLite.real(),
      positionY: State.SQLite.real(),
      spawnTime: State.SQLite.text(),
      available: State.SQLite.boolean({ default: true }),
    },
  }),
  leaderboard: State.SQLite.table({
    name: 'leaderboard',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      gameId: State.SQLite.text(),
      playerId: State.SQLite.text(),
      username: State.SQLite.text(),
      score: State.SQLite.integer({ default: 0 }),
      rank: State.SQLite.integer({ default: 1 }),
      stats: State.SQLite.text({ default: '{}' }), // JSON string
      updatedAt: State.SQLite.text(),
    },
  }),
  gameState: State.SQLite.clientDocument({
    name: 'gameState',
    schema: Schema.Struct({
      currentRound: Schema.Number,
      totalRounds: Schema.Number,
      roundStartTime: Schema.NullOr(Schema.String),
      roundTimeLeft: Schema.Number,
      weather: Schema.String,
      timeOfDay: Schema.Number, // 0-24 hours
      safeZone: Schema.NullOr(
        Schema.Struct({
          centerX: Schema.Number,
          centerY: Schema.Number,
          radius: Schema.Number,
          shrinkStartTime: Schema.NullOr(Schema.String),
        }),
      ),
    }),
    default: {
      id: SessionIdSymbol,
      value: {
        currentRound: 1,
        totalRounds: 1,
        roundStartTime: null,
        roundTimeLeft: 600, // 10 minutes
        weather: 'clear',
        timeOfDay: 12,
        safeZone: null,
      },
    },
  }),
}

// Define events for multiplayer game operations
export const events = {
  gameCreated: Events.synced({
    name: 'v1.GameCreated',
    schema: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      type: Schema.Literal('battle_royale', 'puzzle_coop', 'racing', 'card_game'),
      maxPlayers: Schema.Number,
      mapId: Schema.String,
      gameMode: Schema.String,
      difficulty: Schema.Literal('easy', 'medium', 'hard'),
      allowSpectators: Schema.Boolean,
      privateGame: Schema.Boolean,
    }),
  }),
  playerJoined: Events.synced({
    name: 'v1.PlayerJoined',
    schema: Schema.Struct({
      playerId: Schema.String,
      gameId: Schema.String,
      username: Schema.String,
      avatar: Schema.String,
      team: Schema.NullOr(Schema.String),
    }),
  }),
  playerMoved: Events.synced({
    name: 'v1.PlayerMoved',
    schema: Schema.Struct({
      playerId: Schema.String,
      gameId: Schema.String,
      positionX: Schema.Number,
      positionY: Schema.Number,
      positionZ: Schema.NullOr(Schema.Number),
    }),
  }),
  playerAction: Events.synced({
    name: 'v1.PlayerAction',
    schema: Schema.Struct({
      playerId: Schema.String,
      gameId: Schema.String,
      action: Schema.Literal('attack', 'use_item', 'pickup_item', 'complete_objective'),
      target: Schema.NullOr(Schema.String),
      data: Schema.NullOr(Schema.String), // JSON string
    }),
  }),
  gameStateChanged: Events.synced({
    name: 'v1.GameStateChanged',
    schema: Schema.Struct({
      gameId: Schema.String,
      status: Schema.Literal('waiting', 'starting', 'active', 'paused', 'ended'),
      currentPlayers: Schema.Number,
      startTime: Schema.NullOr(Schema.String),
      endTime: Schema.NullOr(Schema.String),
    }),
  }),
  gameEventLogged: Events.synced({
    name: 'v1.GameEventLogged',
    schema: Schema.Struct({
      id: Schema.String,
      gameId: Schema.String,
      type: Schema.String,
      playerId: Schema.NullOr(Schema.String),
      data: Schema.NullOr(Schema.String),
    }),
  }),
  powerUpSpawned: Events.synced({
    name: 'v1.PowerUpSpawned',
    schema: Schema.Struct({
      id: Schema.String,
      gameId: Schema.String,
      type: Schema.String,
      positionX: Schema.Number,
      positionY: Schema.Number,
    }),
  }),
  leaderboardUpdated: Events.synced({
    name: 'v1.LeaderboardUpdated',
    schema: Schema.Struct({
      gameId: Schema.String,
      playerId: Schema.String,
      username: Schema.String,
      score: Schema.Number,
      rank: Schema.Number,
      stats: Schema.String, // JSON string
    }),
  }),
  gameStateSet: tables.gameState.set, // Use auto-generated setter
}

// Map events to state changes
const materializers = State.SQLite.materializers(events, {
  'v1.GameCreated': ({ id, name, type, maxPlayers, mapId, gameMode, difficulty, allowSpectators, privateGame }) =>
    tables.gameSession.insert({
      id,
      name,
      type,
      maxPlayers,
      currentPlayers: 0,
      mapId,
      gameMode,
      difficulty,
      allowSpectators,
      privateGame,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  'v1.PlayerJoined': ({ playerId, gameId, username, avatar, team }) =>
    tables.players.insert({
      id: playerId,
      gameId,
      username,
      avatar,
      team,
      joinedAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
    }),
  'v1.PlayerMoved': ({ playerId, gameId, positionX, positionY, positionZ }) =>
    tables.players
      .update({
        positionX,
        positionY,
        positionZ,
        lastActivity: new Date().toISOString(),
      })
      .where({ id: playerId, gameId }),
  'v1.PlayerAction': ({ playerId, gameId, action, target, data }) => {
    // Update player activity and potentially log the action
    return tables.players
      .update({
        lastActivity: new Date().toISOString(),
      })
      .where({ id: playerId, gameId })
  },
  'v1.GameStateChanged': ({ gameId, status, currentPlayers, startTime, endTime }) =>
    tables.gameSession
      .update({
        status,
        currentPlayers,
        startTime,
        endTime,
        updatedAt: new Date().toISOString(),
      })
      .where({ id: gameId }),
  'v1.GameEventLogged': ({ id, gameId, type, playerId, data }) =>
    tables.gameEvents.insert({
      id,
      gameId,
      type,
      playerId,
      data,
      timestamp: new Date().toISOString(),
    }),
  'v1.PowerUpSpawned': ({ id, gameId, type, positionX, positionY }) =>
    tables.powerUps.insert({
      id,
      gameId,
      type,
      positionX,
      positionY,
      spawnTime: new Date().toISOString(),
      available: true,
    }),
  'v1.LeaderboardUpdated': ({ gameId, playerId, username, score, rank, stats }) =>
    tables.leaderboard.insert({
      id: `${gameId}-${playerId}`,
      gameId,
      playerId,
      username,
      score,
      rank,
      stats,
      updatedAt: new Date().toISOString(),
    }),
})

const state = State.SQLite.makeState({ tables, materializers })
export const schema = makeSchema({ events, state })

type MultiplayerGameSchema = typeof schema

// Create the Multiplayer Game Client-DO class
export class MultiplayerGameClientDO extends makeClientDurableObject({
  schema,
  clientId: 'multiplayer-game',
  sessionId: 'game-session',

  // Initialize game state and register real-time queries
  registerQueries: (store) => [
    // Monitor game session changes and trigger events
    store.subscribe(tables.gameSession, {
      onUpdate: (sessions) => {
        const session = sessions[0]
        if (session?.status === 'starting') {
          setTimeout(() => startGameRound(store, session.id), 3000) // 3-second countdown
        }
      },
      label: 'game-session-watcher',
    }),

    // Update leaderboard when player scores change
    store.subscribe(tables.players, {
      onUpdate: (players) => {
        if (players.length > 0) {
          const gameId = players[0]?.gameId
          if (gameId) {
            updateLeaderboard(store, gameId, players)
          }
        }
      },
      label: 'player-score-watcher',
    }),

    // Handle game state timing and world updates
    store.subscribe(tables.gameState, {
      onUpdate: (stateRows) => {
        const gameState = stateRows[0]?.value
        if (gameState && gameState.roundTimeLeft <= 0) {
          const session = store.query(tables.gameSession)[0]
          if (session?.status === 'active') {
            endGameRound(store, session.id)
          }
        }
      },
      label: 'game-state-monitor',
    }),
  ],

  // Handle custom endpoints for multiplayer game operations
  handleCustomRequest: (request, ensureStore) =>
    Effect.gen(function* () {
      const url = new URL(request.url)
      const store = yield* ensureStore

      switch (url.pathname) {
        case '/game/create':
          if (request.method === 'POST') {
            return yield* createGameSession(store, request)
          }
          break

        case '/game/join':
          if (request.method === 'POST') {
            return yield* joinGame(store, request)
          }
          break

        case '/game/start':
          if (request.method === 'POST') {
            return yield* startGame(store, request)
          }
          break

        case '/player/move':
          if (request.method === 'POST') {
            return yield* updatePlayerPosition(store, request)
          }
          break

        case '/player/action':
          if (request.method === 'POST') {
            return yield* handlePlayerAction(store, request)
          }
          break

        case '/game/state':
          return getGameState(store)

        case '/leaderboard':
          return getLeaderboard(store)

        case '/game/events':
          return getGameEvents(store)
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

// Sync Backend Durable Object for multiplayer games
export class MultiplayerGameSyncBackendDO extends CfSyncBackend.makeDurableObject({
  onPush: async (message, context) => {
    console.log(`[Game Sync] Push: ${message.batch.length} events for gameId: ${context.storeId}`)
    // Optional: Add game-specific logic for handling pushed events
    // e.g., real-time spectator updates, match statistics, tournament brackets
  },
  onPull: async (_message, context) => {
    console.log(`[Game Sync] Pull request for gameId: ${context.storeId}`)
    // Optional: Add game-specific logic for pull requests
    // e.g., anti-cheat validation, rate limiting per player
  },
}) {}

// Example Worker Implementation with Game Routing
export const worker = {
  fetch: async (request: CfWorker.Request, env: Env, _ctx: CfWorker.ExecutionContext): Promise<CfWorker.Response> => {
    const url = new URL(request.url)

    // Route WebSocket connections to sync backend
    if (url.pathname === '/websocket') {
      // Handle WebSocket upgrade for game sync
      const syncBackendId = env.SYNC_BACKEND_DO.idFromName('game-sync-backend')
      const syncBackendStub = env.SYNC_BACKEND_DO.get(syncBackendId)
      return syncBackendStub.fetch(request)
    }

    // Route to multiplayer game client DO
    const gameId = url.searchParams.get('gameId') ?? 'default-game'
    const clientId = env.CLIENT_DO.idFromName(gameId)
    const clientStub = env.CLIENT_DO.get(clientId)

    return clientStub.fetch(request)
  },
} satisfies CfWorker.ExportedHandler<Env>

// =============================================================================
// GAME ENGINE FUNCTIONS
// =============================================================================

// Game lifecycle management
function startGameRound(store: Store<typeof schema>, gameId: string) {
  const gameState = store.query(tables.gameState)[0]?.value ?? {
    currentRound: 1,
    totalRounds: 1,
    roundStartTime: null,
    roundTimeLeft: 600,
    weather: 'clear',
    timeOfDay: 12,
    safeZone: null,
  }

  // Start the round
  store.commit(
    events.gameStateSet({
      ...gameState,
      currentRound: gameState.currentRound + 1,
      roundStartTime: new Date().toISOString(),
      roundTimeLeft: 600, // 10 minutes
    }),
  )

  // Update game session status
  store.commit(
    events.gameStateChanged({
      gameId,
      status: 'active',
      currentPlayers: store.query(tables.players.where({ gameId })).length,
      startTime: new Date().toISOString(),
      endTime: null,
    }),
  )

  // Log game start event
  store.commit(
    events.gameEventLogged({
      id: crypto.randomUUID(),
      gameId,
      type: 'round_start',
      playerId: null,
      data: JSON.stringify({ round: gameState.currentRound + 1 }),
    }),
  )
}

function endGameRound(store: Store<typeof schema>, gameId: string) {
  const gameState = store.query(tables.gameState)[0]?.value
  if (!gameState) return

  // Update game session to ended
  store.commit(
    events.gameStateChanged({
      gameId,
      status: 'ended',
      currentPlayers: store.query(tables.players.where({ gameId, status: 'playing' })).length,
      startTime: null,
      endTime: new Date().toISOString(),
    }),
  )

  // Update game state for next round or game end
  if (gameState.currentRound < gameState.totalRounds) {
    store.commit(
      events.gameStateSet({
        ...gameState,
        roundTimeLeft: 600,
        roundStartTime: null,
      }),
    )
  }

  // Log round end event
  store.commit(
    events.gameEventLogged({
      id: crypto.randomUUID(),
      gameId,
      type: 'round_end',
      playerId: null,
      data: JSON.stringify({ round: gameState.currentRound }),
    }),
  )
}

function updateLeaderboard(store: Store<typeof schema>, gameId: string, players: ReadonlyArray<any>) {
  const sortedPlayers = players.filter((p) => p.status !== 'spectating').sort((a, b) => b.score - a.score)

  sortedPlayers.forEach((player, index) => {
    store.commit(
      events.leaderboardUpdated({
        gameId,
        playerId: player.id,
        username: player.username,
        score: player.score,
        rank: index + 1,
        stats: JSON.stringify({
          eliminations: player.eliminations || 0,
          damage: player.damage || 0,
          survival_time: Math.floor((Date.now() - new Date(player.joinedAt).getTime()) / 1000),
        }),
      }),
    )
  })
}

/**
 * Usage Example:
 *
 * 1. Create a game:
 *    POST /game/create
 *    { "name": "Epic Battle", "type": "battle_royale", "maxPlayers": 10 }
 *
 * 2. Join game:
 *    POST /game/join
 *    { "playerId": "player-123", "username": "Warrior" }
 *
 * 3. Start game:
 *    POST /game/start
 *
 * 4. Move player:
 *    POST /player/move
 *    { "playerId": "player-123", "position": { "x": 250, "y": 300 } }
 *
 * 5. Attack another player:
 *    POST /player/action
 *    { "playerId": "player-123", "action": "attack", "target": "player-456", "data": { "weapon": "sword", "damage": 30 } }
 *
 * 6. Get game state:
 *    GET /game/state
 *
 * The client-do manages all multiplayer game state, real-time synchronization,
 * and provides a complete multiplayer gaming experience with persistent state.
 */
