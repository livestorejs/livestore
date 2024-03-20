import { describe, expect, it } from 'vitest'

import { ReactiveGraph } from './reactive.js'

describe('a trivial graph', () => {
  const makeGraph = () => {
    const graph = new ReactiveGraph({})
    graph.context = {}
    const a = graph.makeRef(1, { label: 'a' })
    const b = graph.makeRef(2, { label: 'b' })
    const numberOfRunsForC = { runs: 0 }
    const c = graph.makeThunk(
      (get) => {
        numberOfRunsForC.runs++
        return get(a) + get(b)
      },
      { label: 'c' },
    )
    const d = graph.makeRef(3, { label: 'd' })
    const e = graph.makeThunk((get) => get(c) + get(d), { label: 'e' })

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

    expect(graph.atoms.size).toBe(5)

    return { graph, a, b, c, d, e, numberOfRunsForC }
  }

  it('has the right initial values', () => {
    const { c, e } = makeGraph()
    expect(c.computeResult()).toBe(3)
    expect(e.computeResult()).toBe(6)
  })

  it('propagates change through the graph', () => {
    const { graph, a, c, e } = makeGraph()
    graph.setRef(a, 5)
    expect(c.computeResult()).toBe(7)
    expect(e.computeResult()).toBe(10)
  })

  it('does not rerun downstream computations eagerly when an upstream dep changes', () => {
    const { graph, a, c, numberOfRunsForC } = makeGraph()
    expect(numberOfRunsForC.runs).toBe(0)
    graph.setRef(a, 5)
    expect(numberOfRunsForC.runs).toBe(0)
    c.computeResult()
    expect(numberOfRunsForC.runs).toBe(1)
  })

  it('does not rerun c when d is edited and e is rerun', () => {
    const { graph, d, e, numberOfRunsForC } = makeGraph()
    expect(numberOfRunsForC.runs).toBe(0)
    expect(e.computeResult()).toBe(3 + 3)
    expect(numberOfRunsForC.runs).toBe(1)
    graph.setRef(d, 4)
    expect(e.computeResult()).toBe(4 + 3)
    expect(numberOfRunsForC.runs).toBe(1)
  })

  it('cuts off reactive propagation when a thunk evaluates to same result as before', () => {
    const { graph, a, c, d } = makeGraph()

    let numberOfRuns = 0
    const f = graph.makeThunk((get) => {
      numberOfRuns++
      return get(c) + get(d)
    })
    expect(numberOfRuns).toBe(0) // defining f shouldn't run it yet
    f.computeResult()
    expect(numberOfRuns).toBe(1) // refreshing should run it once

    // f doesn't run because a is set to same value as before
    graph.setRef(a, 1)
    expect(f.computeResult()).toBe(6)
    // expect(numberOfRuns).toBe(1) // TODO comp caching

    // f runs because a is set to a different value
    graph.setRef(a, 5)
    expect(f.computeResult()).toBe(10)
    // expect(numberOfRuns).toBe(2) // TODO comp caching

    // f runs again when d is set to a different value
    graph.setRef(d, 4)
    expect(f.computeResult()).toBe(11)
    // expect(numberOfRuns).toBe(3) // TODO comp caching

    // f only runs one time if we set two refs together
    graph.setRefs([
      [a, 6],
      [d, 5],
    ])
    expect(f.computeResult()).toBe(13)
    // expect(numberOfRuns).toBe(4) // TODO comp caching
  })

  it('only runs a thunk once when two upstream refs are updated together', () => {
    const { graph, a, b, c, numberOfRunsForC } = makeGraph()
    graph.setRefs([
      [a, 5],
      [b, 6],
    ])
    expect(numberOfRunsForC.runs).toBe(0)
    expect(c.computeResult()).toBe(11)
    expect(numberOfRunsForC.runs).toBe(1)
  })

  describe('effects', () => {
    // TODO TBD whether we want to keep this as intended behavior
    it(`doesn't run on initial definition`, () => {
      const { graph, c, numberOfRunsForC } = makeGraph()
      expect(numberOfRunsForC.runs).toBe(0)
      c.computeResult()
      expect(numberOfRunsForC.runs).toBe(1)

      let numberOfEffectRuns = 0
      const effect = graph.makeEffect((get) => {
        // establish a dependency on thunk c and mutate an outside value
        expect(get(c)).toBe(3)
        numberOfEffectRuns++
      })
      expect(numberOfEffectRuns).toBe(0)
      expect(numberOfRunsForC.runs).toBe(1)

      effect.doEffect()
      expect(numberOfEffectRuns).toBe(1)
    })

    it('only reruns an effect if the thunk value changed', () => {
      const { graph, a, c } = makeGraph()
      let numberOfEffectRuns = 0
      let aHasChanged = true
      expect(numberOfEffectRuns).toBe(0)
      const effect = graph.makeEffect((get) => {
        // establish a dependency on thunk c and mutate an outside value
        expect(get(c)).toBe(aHasChanged ? 3 : 4)
        numberOfEffectRuns++
      })

      expect(numberOfEffectRuns).toBe(0)
      effect.doEffect()
      expect(numberOfEffectRuns).toBe(1)

      // if we set a to the same value, the effect should not run again
      graph.setRef(a, 1)
      // expect(numberOfCallsToC).toBe(1) // TODO comp caching

      aHasChanged = false

      graph.setRef(a, 2)
      // expect(numberOfCallsToC).toBe(2) // TODO comp caching
    })

    describe('skip refresh', () => {
      it(`defers effect execution until manual run`, () => {
        const { graph, a, c, d, numberOfRunsForC } = makeGraph()

        // using here both to track number oe effect runs and to "update the effect behavior"
        let numberOfEffectRuns = 0
        const effect = graph.makeEffect((get) => {
          expect(get(c)).toBe(numberOfEffectRuns === 0 ? 3 : 4)
          numberOfEffectRuns++
        })

        effect.doEffect()

        expect(numberOfEffectRuns).toBe(1)
        expect(numberOfRunsForC.runs).toBe(1)

        graph.setRef(a, 2, { skipRefresh: true })

        expect(numberOfEffectRuns).toBe(1)
        expect(numberOfRunsForC.runs).toBe(1)

        // Even setting a unrelated ref should not trigger a refresh
        graph.setRef(d, 0)

        expect(numberOfEffectRuns).toBe(1)
        expect(numberOfRunsForC.runs).toBe(1)

        graph.runDeferredEffects()

        expect(numberOfEffectRuns).toBe(2)
        expect(numberOfRunsForC.runs).toBe(2)
      })

      it(`doesn't run deferred effects which have been destroyed already`, () => {
        const { graph, a, c, numberOfRunsForC } = makeGraph()

        let numberOfEffect1Runs = 0
        const effect1 = graph.makeEffect((get) => {
          expect(get(c)).toBe(numberOfEffect1Runs === 0 ? 3 : 4)
          numberOfEffect1Runs++
        })

        let numberOfEffect2Runs = 0
        const effect2 = graph.makeEffect((get) => {
          expect(get(c)).toBe(numberOfEffect2Runs === 0 ? 3 : 4)
          numberOfEffect2Runs++
        })

        effect1.doEffect()
        effect2.doEffect()

        expect(numberOfEffect1Runs).toBe(1)
        expect(numberOfEffect2Runs).toBe(1)
        expect(numberOfRunsForC.runs).toBe(1)

        graph.setRef(a, 2, { skipRefresh: true })

        expect(numberOfEffect1Runs).toBe(1)
        expect(numberOfEffect2Runs).toBe(1)
        expect(numberOfRunsForC.runs).toBe(1)

        graph.destroyNode(effect1)

        graph.runDeferredEffects()

        expect(numberOfEffect1Runs).toBe(1)
        expect(numberOfEffect2Runs).toBe(2)
        expect(numberOfRunsForC.runs).toBe(2)
      })
    })
  })

  describe('destroying nodes', () => {
    it('marks super node as dirty when a sub node is destroyed', () => {
      const { graph, b, c, d, e } = makeGraph()

      e.computeResult()

      graph.destroyNode(b)

      expect(c.isDirty).toBe(true)
      expect(d.isDirty).toBe(false)
      expect(e.isDirty).toBe(true)

      expect(() => c.computeResult()).toThrowErrorMatchingInlineSnapshot(
        `[Error: This should never happen LiveStore Error: Attempted to compute destroyed ref (node-58): b]`,
      )
    })
  })
})

describe('a dynamic graph', () => {
  const makeGraph = () => {
    const graph = new ReactiveGraph({})
    graph.context = {}

    const a = graph.makeRef(1, { label: 'a' })
    const b = graph.makeRef(2, { label: 'b' })
    const c = graph.makeRef<'a' | 'b'>('a', { label: 'c' })
    const numberOfRunsForD = { runs: 0 }
    const d = graph.makeThunk(
      (get) => {
        numberOfRunsForD.runs++
        return get(c) === 'a' ? get(a) : get(b)
      },
      { label: 'd' },
    )
    const e = graph.makeRef(2, { label: 'e' })
    const f = graph.makeThunk((get) => get(d) * get(e), { label: 'f' })

    // a(1)   b(2)   c('a')
    //  \     /    /
    //   \   /  /
    //     d = a or b depending on c
    //       \
    //        \
    //  e(2)   \
    //   \      \
    //    \      \
    //      f = d * e

    expect(graph.atoms.size).toBe(6)

    return { graph, a, b, c, d, e, f, numberOfRunsForD }
  }

  it('has the right initial values', () => {
    const { d, f } = makeGraph()
    expect(d.computeResult()).toBe(1)
    expect(f.computeResult()).toBe(2)
  })

  it('dynamically adjusts d when a, b or c changes', () => {
    const { graph, c, d, e, f, numberOfRunsForD } = makeGraph()
    expect(numberOfRunsForD.runs).toBe(0)
    expect(d.computeResult()).toBe(1)
    expect(f.computeResult()).toBe(2)
    expect(numberOfRunsForD.runs).toBe(1)
    graph.setRef(c, 'b')
    expect(d.computeResult()).toBe(2)
    expect(f.computeResult()).toBe(4)
    expect(numberOfRunsForD.runs).toBe(2)
    graph.setRef(e, 3)
    expect(f.computeResult()).toBe(6)
    expect(numberOfRunsForD.runs).toBe(2)
  })

  it('runs d only when a changes, not b', () => {
    const { graph, a, b, d, numberOfRunsForD } = makeGraph()
    numberOfRunsForD.runs = 0
    d.computeResult()
    expect(numberOfRunsForD.runs).toBe(1)
    graph.setRef(a, 3)
    expect(d.computeResult()).toBe(3)
    expect(numberOfRunsForD.runs).toBe(2)
    graph.setRef(b, 4)
    expect(d.computeResult()).toBe(3)
    expect(numberOfRunsForD.runs).toBe(2)
  })
})

describe('a diamond shaped graph', () => {
  const makeGraph = () => {
    const graph = new ReactiveGraph({})
    graph.context = {}
    const a = graph.makeRef(1)
    const b = graph.makeThunk((get) => get(a) + 1)
    const c = graph.makeThunk((get) => get(a) + 1)

    // track the number of times d has run in an object so we can mutate it
    const dRuns = { runs: 0 }

    // normally thunks aren't supposed to side effect;
    // we do it here to track the number of times d has run
    const d = graph.makeThunk((get) => {
      dRuns.runs++
      return get(b) + get(c)
    })

    // a(1)
    //  / \
    // b   c
    //  \ /
    //   d = b + c

    expect(graph.atoms.size).toBe(4)

    return { graph, a, b, c, d, dRuns }
  }

  it('has the right initial values', () => {
    const { b, c, d } = makeGraph()
    expect(b.computeResult()).toBe(2)
    expect(c.computeResult()).toBe(2)
    expect(d.computeResult()).toBe(4)
  })

  it('propagates change through the graph', () => {
    const { graph, a, b, c, d } = makeGraph()
    graph.setRef(a, 5)
    expect(b.computeResult()).toBe(6)
    expect(c.computeResult()).toBe(6)
    expect(d.computeResult()).toBe(12)
  })

  // if we're being efficient, we should update b and c before updating d,
  // so d only needs to update one time
  it('only runs d once when a changes', () => {
    const { graph, a, d, dRuns } = makeGraph()
    expect(dRuns.runs).toBe(0)
    d.computeResult()
    expect(dRuns.runs).toBe(1)
    graph.setRef(a, 5)
    d.computeResult()
    d.computeResult() // even extra calls to computeResult should not run d again
    expect(dRuns.runs).toBe(2)
  })
})

describe('a trivial graph with undefined', () => {
  const makeGraph = () => {
    const graph = new ReactiveGraph({})
    graph.context = {}
    const a = graph.makeRef(1)
    const b = graph.makeRef(undefined)
    const c = graph.makeThunk((get) => {
      return get(a) + (get(b) ?? 0)
    })
    const d = graph.makeRef(3)
    const e = graph.makeThunk((get) => get(c) + get(d))

    // a(1)   b(undefined)
    //   \     /
    //    \   /
    //      c = a + b
    //       \
    //        \
    // d(3)    \
    //   \       \
    //    \       \
    //      e = c + d

    expect(graph.atoms.size).toBe(5)

    return { graph, a, b, c, d, e }
  }

  it('has the right initial values', () => {
    const { c, e } = makeGraph()
    expect(c.computeResult()).toBe(1)
    expect(e.computeResult()).toBe(4)
  })
})

describe('error handling', () => {
  it('throws an error when no context is set', () => {
    const graph = new ReactiveGraph({})
    const a = graph.makeRef(1)
    const b = graph.makeThunk((get) => get(a) + 1)
    expect(() => b.computeResult()).toThrowErrorMatchingInlineSnapshot(
      `[Error: LiveStore Error: \`context\` not set on ReactiveGraph (graph-19)]`,
    )
  })
})
