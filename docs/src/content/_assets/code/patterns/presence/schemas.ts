import { Schema } from '@livestore/utils/effect'

export const CursorState = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
})

export const TypingState = Schema.Struct({
  isTyping: Schema.Boolean,
})

export const presenceSchemas = {
  cursor: CursorState,
  typing: TypingState,
} as const
