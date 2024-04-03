import 'fast-text-encoding'

import { getRandomValues } from 'expo-crypto'

globalThis.crypto = globalThis.crypto ?? {}

globalThis.crypto.getRandomValues = (arr) => getRandomValues(arr as any)

globalThis.performance.mark = globalThis.performance.mark ?? (() => {})
globalThis.performance.measure = globalThis.performance.measure ?? (() => {})
