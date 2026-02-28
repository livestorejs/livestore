import { expect, it } from 'vitest'

import { isValidFunctionString } from './function-string.ts'

it('should detect no-arg Hermes bytecode string', () => {
  expect(isValidFunctionString('function() { [bytecode] }')._tag).toBe('invalid')
})

it('should detect Hermes bytecode string with params', () => {
  // Hermes stringifies arrow functions with params as e.g. `function (a0) { [bytecode] }`
  expect(isValidFunctionString('function (a0) { [bytecode] }')._tag).toBe('invalid')
})

it('should accept normal function strings', () => {
  expect(isValidFunctionString('function (get) { return get(todos$) }')._tag).toBe('valid')
})

it('should accept query strings', () => {
  expect(isValidFunctionString('SELECT * FROM todos')._tag).toBe('valid')
})
