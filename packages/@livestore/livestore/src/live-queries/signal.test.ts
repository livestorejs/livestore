import { Effect } from '@livestore/utils/effect'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

import { makeTodoMvc } from '../utils/tests/fixture.js'
import { computed } from './computed.js'
import { signal } from './signal.js'

Vitest.describe('signal', () => {
  Vitest.scopedLive('should be able to create a signal', () =>
    Effect.gen(function* () {
      const num$ = signal(0, { label: 'num$' })

      const duplicated$ = computed((get) => get(num$) * 2, { label: 'duplicated$' })

      const store = yield* makeTodoMvc({})

      expect(store.query(duplicated$)).toBe(0)

      store.setSignal(num$, 1)

      expect(store.query(duplicated$)).toBe(2)
    }),
  )
})
