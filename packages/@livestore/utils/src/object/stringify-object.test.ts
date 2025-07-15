import { describe, expect, it } from 'vitest'
import { stringifyObject } from './stringify-object.ts'

describe('stringifyObject', () => {
  it('stringifies a flat object', () => {
    const obj = { a: 1, b: 'test', c: true }
    expect(stringifyObject(obj)).toBe('a=1 b=test c=true')
  })

  it('stringifies a nested object with dot notation', () => {
    const obj = { a: 1, b: { c: 2, d: 'x' } }
    expect(stringifyObject(obj)).toBe('a=1 b.c=2 b.d=x')
  })

  it('stringifies an object with array values', () => {
    const obj = { a: [1, 2, 3], b: 'x' }
    expect(stringifyObject(obj)).toBe('a=1,2,3 b=x')
  })

  it('handles objects with undefined and null values', () => {
    const obj = { a: undefined, b: null, c: 1 }
    expect(stringifyObject(obj)).toBe('a=undefined b=null c=1')
  })

  it('handles deeply nested objects', () => {
    const obj = { a: { b: { c: { d: 1 } } } }
    expect(stringifyObject(obj)).toBe('a.b.c.d=1')
  })

  it('handles complex nested objects with arrays', () => {
    const obj = {
      config: {
        values: [1, 2],
        settings: { enabled: true },
      },
      name: 'test',
    }
    expect(stringifyObject(obj)).toBe('config.values=1,2 config.settings.enabled=true name=test')
  })

  it('handles empty object', () => {
    expect(stringifyObject({})).toBe('')
  })
})
