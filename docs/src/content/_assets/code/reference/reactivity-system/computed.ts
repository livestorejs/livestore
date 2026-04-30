/** biome-ignore-all lint/correctness/noUnusedVariables: docs snippet highlights derived signal */
// ---cut---
import { computed, signal } from '@livestore/livestore'

const num$ = signal(0, { label: 'num$' })
const duplicated$ = computed((get) => get(num$) * 2, { label: 'duplicated$' })
