/* eslint-disable unicorn/prefer-global-this */
/**
 * Based on:
 *
 * cuid.js
 * Collision-resistant UID generator for browsers and node.
 * Sequential for fast db lookups and recency sorting.
 * Safe for element IDs and server-side lookups.
 *
 * Extracted from CLCTR
 *
 * Copyright (c) Eric Elliott 2012
 * MIT License
 */

const lim = 2 ** 32 - 1

const crypto = globalThis.crypto

const getRandomValue = () => {
  return Math.abs(crypto.getRandomValues(new Uint32Array(1))[0]! / lim)
}

const pad = (num: number | string, size: number) => {
  const s = `000000000${num}`
  return s.slice(s.length - size)
}

const env = typeof window === 'object' ? window : self
const globalCount = Object.keys(env).length

// To make it work in React Native https://github.com/paralleldrive/cuid/issues/54#issuecomment-222957293
const clientId =
  navigator.product === 'ReactNative'
    ? 'rn'
    : pad(navigator.userAgent.length.toString(36) + globalCount.toString(36), 4)

const fingerprint = () => clientId

let c = 0
const blockSize = 4
const base = 36
const discreteValues = base ** blockSize

const randomBlock = () => {
  return pad(Math.trunc(getRandomValue() * discreteValues).toString(base), blockSize)
}

const safeCounter = () => {
  c = c < discreteValues ? c : 0
  c++ // this is not subliminal
  return c - 1
}

export const cuid = () => {
  // Starting with a lowercase letter makes
  // it HTML element ID friendly.
  const letter = 'c' // hard-coded allows for sequential access
  // timestamp
  // warning: this exposes the exact date and time
  // that the uid was created.
  const timestamp = Date.now().toString(base)
  // Prevent same-machine collisions.
  const counter = pad(safeCounter().toString(base), blockSize)
  // A few chars to generate distinct ids for different
  // clients (so different computers are far less
  // likely to generate the same id)
  const print = fingerprint()
  // Grab some more chars from Math.random()
  const random = randomBlock() + randomBlock()

  return letter + timestamp + counter + print + random
}

export const slug = () => {
  const date = Date.now().toString(36)
  const counter = safeCounter().toString(36).slice(-4)
  const print = fingerprint().slice(0, 1) + fingerprint().slice(-1)
  const random = randomBlock().slice(-2)

  return date.slice(-2) + counter + print + random
}

export const isCuid = (stringToCheck: string) => {
  if (typeof stringToCheck !== 'string') return false
  if (stringToCheck.startsWith('c')) return true
  return false
}

export const isSlug = (stringToCheck: string) => {
  if (typeof stringToCheck !== 'string') return false
  const stringLength = stringToCheck.length
  if (stringLength >= 7 && stringLength <= 10) return true
  return false
}
