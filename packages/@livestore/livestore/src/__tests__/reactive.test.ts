import { makeNoopTracer } from '@livestore/utils'
import * as otel from '@opentelemetry/api'
import { describe, expect, it } from 'vitest'

import { NOT_REFRESHED_YET, ReactiveGraph } from '../reactive.js'

const mockOtelCtx = otel.context.active()

describe('a trivial graph', () => {
  const makeGraph = () => {
    const graph = new ReactiveGraph({ otelTracer: makeNoopTracer() })
    graph.context = {}
    const a = graph.makeRef(1)
    const b = graph.makeRef(2)
    const numberOfRunsForC = { runs: 0 }
    const c = graph.makeThunk((get) => {
      numberOfRunsForC.runs++
      return get(a) + get(b)
    }, undefined)
    const d = graph.makeRef(3)
    const e = graph.makeThunk((get) => get(c) + get(d), undefined)

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
    const { graph, c, e } = makeGraph()
    expect(c.result).toBe(NOT_REFRESHED_YET)
    expect(e.result).toBe(NOT_REFRESHED_YET)
    graph.refresh()
    expect(c.result).toBe(3)
    expect(e.result).toBe(6)
  })

  it('propagates change through the graph', () => {
    const { graph, a, c, e } = makeGraph()
    graph.setRef(a, 5, undefined)
    graph.refresh()
    expect(c.result).toBe(7)
    expect(e.result).toBe(10)
  })

  it('cuts off reactive propagation when a thunk evaluates to same result as before', () => {
    const { graph, a, c, d } = makeGraph()

    let numberOfRuns = 0
    const f = graph.makeThunk((get) => {
      numberOfRuns++
      return get(c) + get(d)
    }, undefined)
    expect(numberOfRuns).toBe(0) // defining f shouldn't run it yet
    graph.refresh()
    expect(numberOfRuns).toBe(1) // refreshing should run it once

    // f doesn't run because a is set to same value as before
    graph.setRef(a, 1, undefined)
    graph.refresh()
    expect(f.result).toBe(6)
    expect(numberOfRuns).toBe(1)

    // f runs because a is set to a different value
    graph.setRef(a, 5, undefined)
    graph.refresh()
    expect(f.result).toBe(10)
    expect(numberOfRuns).toBe(2)

    // f runs again when d is set to a different value
    graph.setRef(d, 4, undefined)
    graph.refresh()
    expect(f.result).toBe(11)
    expect(numberOfRuns).toBe(3)

    // f only runs one time if we set two refs together
    graph.setRefs(
      [
        [a, 6],
        [d, 5],
      ],
      undefined,
    )
    graph.refresh()
    expect(f.result).toBe(13)
    expect(numberOfRuns).toBe(4)
  })

  it('only runs a thunk once when two upstream refs are updated together', () => {
    const { graph, a, b, c, numberOfRunsForC } = makeGraph()
    graph.refresh()
    expect(numberOfRunsForC.runs).toBe(1)
    graph.setRefs(
      [
        [a, 5],
        [b, 6],
      ],
      undefined,
    )
    graph.refresh()
    expect(numberOfRunsForC.runs).toBe(2)
    expect(c.result).toBe(11)
  })

  // TODO those tests are probably not needed anymore @geoffreylitt

  // it('skips refresh when that option is passed when setting a single ref', () => {
  //   const { graph, a, c, numberOfRunsForC } = makeGraph()
  //   expect(numberOfRunsForC.runs).toBe(1)

  //   graph.setRef(a, 5)

  //   // C hasn't changed
  //   expect(numberOfRunsForC.runs).toBe(1)
  //   expect(c.result).toBe(3)

  //   // Now we trigger a refresh and everything runs
  //   graph.refresh()
  //   expect(numberOfRunsForC.runs).toBe(2)
  //   expect(c.result).toBe(7)
  // })

  // it('skips refresh when that option is passed when setting multiple refs together', () => {
  //   const { graph, a, b, c, numberOfRunsForC } = makeGraph()
  //   expect(numberOfRunsForC.runs).toBe(1)

  //   graph.setRefs([
  //     [a, 5],
  //     [b, 6],
  //   ])

  //   // C hasn't changed
  //   expect(numberOfRunsForC.runs).toBe(1)
  //   expect(c.result).toBe(3)

  //   // Now we trigger a refresh and everything runs
  //   graph.refresh()
  //   expect(numberOfRunsForC.runs).toBe(2)
  //   expect(c.result).toBe(11)
  // })

  describe('effects', () => {
    it('only reruns an effect if the thunk value changed', () => {
      const { graph, a, c } = makeGraph()
      let numberOfCallsToC = 0
      graph.makeEffect((get) => {
        // establish a dependency on thunk c and mutate an outside value
        get(c)
        numberOfCallsToC++
      }, undefined)
      expect(numberOfCallsToC).toBe(0)
      graph.refresh()
      expect(numberOfCallsToC).toBe(1)

      // if we set a to the same value, the effect should not run again
      graph.setRef(a, 1, undefined)
      graph.refresh()
      expect(numberOfCallsToC).toBe(1)

      graph.setRef(a, 2, undefined)
      graph.refresh()
      expect(numberOfCallsToC).toBe(2)
    })
  })
})

describe('a diamond shaped graph', () => {
  const makeGraph = () => {
    const graph = new ReactiveGraph({ otelTracer: makeNoopTracer() })
    graph.context = {}
    const a = graph.makeRef(1)
    const b = graph.makeThunk((get) => get(a) + 1, undefined)
    const c = graph.makeThunk((get) => get(a) + 1, undefined)

    // track the number of times d has run in an object so we can mutate it
    const dRuns = { runs: 0 }

    // normally thunks aren't supposed to side effect;
    // we do it here to track the number of times d has run
    const d = graph.makeThunk((get) => {
      dRuns.runs++
      return get(b) + get(c)
    }, undefined)

    // a(1)
    //  / \
    // b   c
    //  \ /
    //   d = b + c

    return { graph, a, b, c, d, dRuns }
  }

  it('has the right initial values', () => {
    const { graph, b, c, d } = makeGraph()
    graph.refresh()
    expect(b.result).toBe(2)
    expect(c.result).toBe(2)
    expect(d.result).toBe(4)
  })

  it('propagates change through the graph', () => {
    const { graph, a, b, c, d } = makeGraph()
    graph.setRef(a, 5, undefined)
    graph.refresh()
    expect(b.result).toBe(6)
    expect(c.result).toBe(6)
    expect(d.result).toBe(12)
  })

  // if we're being efficient, we should update b and c before updating d,
  // so d only needs to update one time
  it('only runs d once when a changes', () => {
    const { graph, a, dRuns } = makeGraph()
    expect(dRuns.runs).toBe(0)
    graph.refresh()
    expect(dRuns.runs).toBe(1)
    graph.setRef(a, 5, undefined)
    graph.refresh()
    expect(dRuns.runs).toBe(2)
  })
})

describe('a trivial graph with undefined', () => {
  const makeGraph = () => {
    const graph = new ReactiveGraph({ otelTracer: makeNoopTracer() })
    graph.context = {}
    const a = graph.makeRef(undefined)
    const b = graph.makeRef(2)
    const numberOfRunsForC = { runs: 0 }
    const c = graph.makeThunk((get) => {
      numberOfRunsForC.runs++
      return (get(a) ?? 0) + get(b)
    }, undefined)
    const d = graph.makeRef(3)
    const e = graph.makeThunk((get) => get(c) + get(d), undefined)

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
    const { graph, c, e } = makeGraph()
    graph.refresh()
    expect(c.result).toBe(2)
    expect(e.result).toBe(5)
  })
})
