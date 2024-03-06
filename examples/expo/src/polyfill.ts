import 'fast-text-encoding'

import { getRandomValues } from 'expo-crypto'

globalThis.crypto = globalThis.crypto ?? {}

globalThis.crypto.getRandomValues = (arr) => getRandomValues(arr as any)
