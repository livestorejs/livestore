import { nanoid } from '@livestore/utils/nanoid'

export const generateTodos = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: nanoid(),
    text: `Todo item ${i + 1}`,
    completed: Math.random() > 0.7,
    deleted: Math.random() > 0.9 ? Date.now() : null,
  }))

export const DatabaseSize = {
  SMALL: 100,
  MEDIUM: 1000,
  LARGE: 10_000,
  XLARGE: 100_000,
} as const

export type DatabaseSize = (typeof DatabaseSize)[keyof typeof DatabaseSize]

export const generateDatabase = (size: DatabaseSize) => generateTodos(size)
