import { getRandomValues } from 'expo-crypto'

// Minimal, typed shims required by a few deps under React Native
globalThis.crypto ??= {} as Crypto
globalThis.crypto.getRandomValues ??= getRandomValues as Crypto['getRandomValues']

globalThis.performance.mark ??= (() => {})
globalThis.performance.measure ??= (() => {})
