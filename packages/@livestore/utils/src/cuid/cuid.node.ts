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

import crypto from 'node:crypto'
import os from 'node:os'

const lim = 2 ** 32 - 1

const getRandomValue = () => {
  return Math.abs(crypto.randomBytes(4).readInt32BE() / lim)
}

const pad = (num: number | string, size: number) => {
  const s = '000000000' + num
  return s.slice(s.length - size)
}

const fingerprint = () => {
  const padding = 2
  const pid = pad(process.pid.toString(36), padding)
  const hostname = os.hostname()
  const length = hostname.length
  const hostId = pad(
    hostname
      .split('')
      .reduce((prev, char) => {
        // eslint-disable-next-line unicorn/prefer-code-point
        return +prev + char.charCodeAt(0)
      }, +length + 36)
      .toString(36),
    padding,
  )

  return pid + hostId
}

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
