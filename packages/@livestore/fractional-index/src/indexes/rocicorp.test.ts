import { describe, expect, test } from 'vitest'

import { generateKeyBetween, generateNKeysBetween, incrementInteger } from './rocicorp.js'

/**
 * @param {string | null} a
 * @param {string | null} b
 * @param {string} exp
 */
const testGenerateKeyBetween = (a: string | null, b: string | null, exp: string) => {
  test(`generateKeyBetween(${a}, ${b}) == ${exp}`, () => {
    try {
      expect(generateKeyBetween(a, b)).toBe(exp)
    } catch (err: any) {
      expect(err.message.replace('This should never happen: ', '')).toBe(exp)
    }
  })
}

describe('generateKeyBetween', () => {
  testGenerateKeyBetween(null, null, 'a0')
  testGenerateKeyBetween(null, 'a0', 'Zz')
  testGenerateKeyBetween(null, 'Zz', 'Zy')
  testGenerateKeyBetween('a0', null, 'a1')
  testGenerateKeyBetween('a1', null, 'a2')
  testGenerateKeyBetween('a0', 'a1', 'a0V')
  testGenerateKeyBetween('a1', 'a2', 'a1V')
  testGenerateKeyBetween('a0V', 'a1', 'a0l')
  testGenerateKeyBetween('Zz', 'a0', 'ZzV')
  testGenerateKeyBetween('Zz', 'a1', 'a0')
  testGenerateKeyBetween(null, 'Y00', 'Xzzz')
  // TODO re-enable this test
  // testGenerateKeyBetween('bzz', null, 'c000')
  testGenerateKeyBetween('a0', 'a0V', 'a0G')
  testGenerateKeyBetween('a0', 'a0G', 'a08')
  testGenerateKeyBetween('b125', 'b129', 'b127')
  testGenerateKeyBetween('a0', 'a1V', 'a1')
  testGenerateKeyBetween('Zz', 'a01', 'a0')
  testGenerateKeyBetween(null, 'a0V', 'a0')
  testGenerateKeyBetween(null, 'b999', 'b99')
  testGenerateKeyBetween(null, 'A00000000000000000000000000', 'invalid order key: A00000000000000000000000000')
  testGenerateKeyBetween(null, 'A000000000000000000000000001', 'A000000000000000000000000000V')
  testGenerateKeyBetween('zzzzzzzzzzzzzzzzzzzzzzzzzzy', null, 'zzzzzzzzzzzzzzzzzzzzzzzzzzz')
  testGenerateKeyBetween('zzzzzzzzzzzzzzzzzzzzzzzzzzz', null, 'zzzzzzzzzzzzzzzzzzzzzzzzzzzV')
  testGenerateKeyBetween('a00', null, 'invalid order key: a00')
  testGenerateKeyBetween('a00', 'a1', 'invalid order key: a00')
  testGenerateKeyBetween('0', '1', 'invalid order key head: 0')
  testGenerateKeyBetween('a1', 'a0', 'a1 >= a0')
})

const testGenerateNKeysBetween = (base: string) => (a: string | null, b: string | null, n: number, exp: string) => {
  test(`generateNKeysBetween(${a}, ${b}, ${n}) == ${exp}`, () => {
    try {
      expect(generateNKeysBetween(a, b, n, base).join(' ')).toBe(exp)
    } catch (err: any) {
      expect(err.message.replace('This should never happen: ', '')).toBe(exp)
    }
  })
}

describe('generateNKeysBetween - base 10', () => {
  const BASE_10_DIGITS = '0123456789'
  const test10 = testGenerateNKeysBetween(BASE_10_DIGITS)
  test10(null, null, 5, 'a0 a1 a2 a3 a4')
  // TODO re-enable this test
  // test10('a4', null, 10, 'a5 a6 a7 a8 a9 b00 b01 b02 b03 b04')
  test10(null, 'a0', 5, 'Z5 Z6 Z7 Z8 Z9')
  test10('a0', 'a2', 20, 'a01 a02 a03 a035 a04 a05 a06 a07 a08 a09 a1 a11 a12 a13 a14 a15 a16 a17 a18 a19')
})

describe('generateNKeysBetween - base 95', () => {
  const BASE_95_DIGITS =
    ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~'
  const test95 = testGenerateNKeysBetween(BASE_95_DIGITS)
  test95('a00', 'a01', 1, 'a00P')
  test95('a0/', 'a00', 1, 'a0/P')
  test95(null, null, 1, 'a ')
  test95('a ', null, 1, 'a!')
  test95(null, 'a ', 1, 'Z~')
  test95('a0 ', 'a0!', 1, 'invalid order key: a0 ')
  test95(null, 'A                          0', 1, 'A                          (')
  test95('a~', null, 1, 'b  ')
  test95('Z~', null, 1, 'a ')
  test95('b   ', null, 1, 'invalid order key: b   ')
  test95('a0', 'a0V', 1, 'a0;')
  test95('a  1', 'a  2', 1, 'a  1P')
  test95(null, 'A                          ', 1, 'invalid order key: A                          ')
})

test('incrementInteger', () => {
  expect(incrementInteger('a0')).toBe('a1')
  expect(incrementInteger('ay')).toBe('az')
  expect(incrementInteger('az')).toBe('b')
})
