import { makeNoopTracer } from '@livestore/utils'
import * as otel from '@opentelemetry/api'
import { describe, expect, it } from 'vitest'

import { ReactiveGraph } from '../reactive.js'

const mockOtelCtx = otel.context.active()

describe('a trivial graph', () => {
  const makeGraph = () => {
    const graph = new ReactiveGraph({ otelTracer: makeNoopTracer() })
    const a = graph.makeRef(1)
    const b = graph.makeRef(2)
    const numberOfRunsForC = { runs: 0 }
    const c = graph.makeThunk(
      (get) => {
        numberOfRunsForC.runs++
        return get(a) + get(b)
      },
      undefined,
      mockOtelCtx,
    )
    const d = graph.makeRef(3)
    const e = graph.makeThunk((get) => get(c) + get(d), undefined, mockOtelCtx)

    // a(1)   b(2)
    //   \     /
    //    \   /
    //      c = a + b
    //       \
    //        \
    // d(3)    \
    //   \       \
    //    \       \
    //      e = c + d

    return { graph, a, b, c, d, e, numberOfRunsForC }
  }

  it('has the right initial values', () => {
    const { c, e } = makeGraph()
    expect(c.result).toBe(3)
    expect(e.result).toBe(6)
  })

  it('propagates change through the graph', () => {
    const { graph, a, c, e } = makeGraph()
    graph.setRef(a, 5, undefined, mockOtelCtx)
    expect(c.result).toBe(7)
    expect(e.result).toBe(10)
  })

  it('cuts off reactive propagation when a thunk evaluates to same result as before', () => {
    const { graph, a, c, d } = makeGraph()

    let numberOfRuns = 0
    const f = graph.makeThunk(
      (get) => {
        numberOfRuns++
        return get(c) + get(d)
      },
      undefined,
      mockOtelCtx,
    )
    expect(numberOfRuns).toBe(1) // initializing f should run it once

    // f doesn't run because a is set to same value as before
    graph.setRef(a, 1, undefined, mockOtelCtx)
    expect(f.result).toBe(6)
    expect(numberOfRuns).toBe(1)

    // f runs because a is set to a different value
    graph.setRef(a, 5, undefined, mockOtelCtx)
    expect(f.result).toBe(10)
    expect(numberOfRuns).toBe(2)

    // f runs again when d is set to a different value
    graph.setRef(d, 4, undefined, mockOtelCtx)
    expect(f.result).toBe(11)
    expect(numberOfRuns).toBe(3)

    // f only runs one time if we set two refs together
    graph.setRefs(
      [
        [a, 6],
        [d, 5],
      ],
      undefined,
      mockOtelCtx,
    )
    expect(f.result).toBe(13)
    expect(numberOfRuns).toBe(4)
  })

  it('only runs a thunk once when two upstream refs are updated together', () => {
    const { graph, a, b, c, numberOfRunsForC } = makeGraph()
    expect(numberOfRunsForC.runs).toBe(1)
    graph.setRefs(
      [
        [a, 5],
        [b, 6],
      ],
      undefined,
      mockOtelCtx,
    )
    expect(numberOfRunsForC.runs).toBe(2)
    expect(c.result).toBe(11)
  })

  it('skips refresh when that option is passed when setting a single ref', () => {
    const { graph, a, c, numberOfRunsForC } = makeGraph()
    expect(numberOfRunsForC.runs).toBe(1)

    graph.setRef(a, 5, { skipRefresh: true }, mockOtelCtx)

    // C hasn't changed
    expect(numberOfRunsForC.runs).toBe(1)
    expect(c.result).toBe(3)

    // Now we trigger a refresh and everything runs
    graph.refresh(undefined, mockOtelCtx)
    expect(numberOfRunsForC.runs).toBe(2)
    expect(c.result).toBe(7)
  })

  it('skips refresh when that option is passed when setting multiple refs together', () => {
    const { graph, a, b, c, numberOfRunsForC } = makeGraph()
    expect(numberOfRunsForC.runs).toBe(1)

    graph.setRefs(
      [
        [a, 5],
        [b, 6],
      ],
      { skipRefresh: true },
      mockOtelCtx,
    )

    // C hasn't changed
    expect(numberOfRunsForC.runs).toBe(1)
    expect(c.result).toBe(3)

    // Now we trigger a refresh and everything runs
    graph.refresh(undefined, mockOtelCtx)
    expect(numberOfRunsForC.runs).toBe(2)
    expect(c.result).toBe(11)
  })

  describe('effects', () => {
    it('only reruns an effect if the thunk value changed', () => {
      const { graph, a, c } = makeGraph()
      let numberOfCallsToC = 0
      graph.makeEffect(
        (get) => {
          // establish a dependency on thunk c and mutate an outside value
          get(c)
          numberOfCallsToC++
        },
        undefined,
        mockOtelCtx,
      )
      expect(numberOfCallsToC).toBe(1)

      // if we set a to the same value, the effect should not run again
      graph.setRef(a, 1, undefined, mockOtelCtx)
      expect(numberOfCallsToC).toBe(1)

      graph.setRef(a, 2, undefined, mockOtelCtx)
      expect(numberOfCallsToC).toBe(2)
    })
  })
})

describe('a diamond shaped graph', () => {
  const makeGraph = () => {
    const graph = new ReactiveGraph({ otelTracer: makeNoopTracer() })
    const a = graph.makeRef(1)
    const b = graph.makeThunk((get) => get(a) + 1, undefined, mockOtelCtx)
    const c = graph.makeThunk((get) => get(a) + 1, undefined, mockOtelCtx)

    // track the number of times d has run in an object so we can mutate it
    const dRuns = { runs: 0 }

    // normally thunks aren't supposed to side effect;
    // we do it here to track the number of times d has run
    const d = graph.makeThunk(
      (get) => {
        dRuns.runs++
        return get(b) + get(c)
      },
      undefined,
      mockOtelCtx,
    )

    // a(1)
    //  / \
    // b   c
    //  \ /
    //   d = b + c

    return { graph, a, b, c, d, dRuns }
  }

  it('has the right initial values', () => {
    const { b, c, d } = makeGraph()
    expect(b.result).toBe(2)
    expect(c.result).toBe(2)
    expect(d.result).toBe(4)
  })

  it('propagates change through the graph', () => {
    const { graph, a, b, c, d } = makeGraph()
    graph.setRef(a, 5, undefined, mockOtelCtx)
    expect(b.result).toBe(6)
    expect(c.result).toBe(6)
    expect(d.result).toBe(12)
  })

  // if we're being efficient, we should update b and c before updating d,
  // so d only needs to update one time
  it('only runs d once when a changes', () => {
    const { graph, a, dRuns } = makeGraph()
    expect(dRuns.runs).toBe(1)
    graph.setRef(a, 5, undefined, mockOtelCtx)
    expect(dRuns.runs).toBe(2)
  })
})
