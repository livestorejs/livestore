import { describe, expect, test } from 'vitest'

import { FI } from './index.js'

test('no changes', () => {
  const previousAgg = FI.aggregateMake(['a', 'b', 'c'], FI.fractionalIndexImplNumber)
  const items = ['a', 'b', 'c']
  const { newAgg, newEvents } = FI.getNewEvents(previousAgg, items, FI.fractionalIndexImplNumber)
  compareAggregates(newAgg, previousAgg)
  compareEvents(newEvents, [])
})

describe('add', () => {
  test('add a, b, c to empty agg', () => {
    const previousAgg = FI.aggregateMake([], FI.fractionalIndexImplNumber)
    const items = ['a', 'b', 'c']
    const { newAgg, newEvents } = FI.getNewEvents(previousAgg, items, FI.fractionalIndexImplNumber)
    compareAggregates(
      newAgg,
      FI.aggregateMakeWithIndex([
        ['a', 1],
        ['b', 2],
        ['c', 3],
      ]),
    )
    compareEvents(newEvents, [
      { op: 'add', value: 'a', index: FI.indexNumber(1) },
      { op: 'add', value: 'b', index: FI.indexNumber(2) },
      { op: 'add', value: 'c', index: FI.indexNumber(3) },
    ])
  })

  test('add a, c to agg with b', () => {
    const previousAgg = FI.aggregateMake(['b'], FI.fractionalIndexImplNumber)
    const items = ['a', 'b', 'c']
    const { newAgg, newEvents } = FI.getNewEvents(previousAgg, items, FI.fractionalIndexImplNumber)
    compareAggregates(
      newAgg,
      FI.aggregateMakeWithIndex([
        ['a', 0.5],
        ['b', 1],
        ['c', 2],
      ]),
    )
    compareEvents(newEvents, [
      { op: 'add', value: 'a', index: FI.indexNumber(0.5) },
      { op: 'add', value: 'c', index: FI.indexNumber(2) },
    ])
  })

  test('add a to agg with b, c', () => {
    const previousAgg = FI.aggregateMake(['b', 'c'], FI.fractionalIndexImplNumber)
    const items = ['a', 'b', 'c']
    const { newAgg, newEvents } = FI.getNewEvents(previousAgg, items, FI.fractionalIndexImplNumber)
    compareAggregates(
      newAgg,
      FI.aggregateMakeWithIndex([
        ['a', 0.5],
        ['b', 1],
        ['c', 2],
      ]),
    )
    compareEvents(newEvents, [{ op: 'add', value: 'a', index: FI.indexNumber(0.5) }])
  })

  test('add c at the end', () => {
    const previousAgg = FI.aggregateMake(['a', 'b'], FI.fractionalIndexImplNumber)
    const items = ['a', 'b', 'c']
    const { newAgg, newEvents } = FI.getNewEvents(previousAgg, items, FI.fractionalIndexImplNumber)
    compareAggregates(
      newAgg,
      FI.aggregateMakeWithIndex([
        ['a', 1],
        ['b', 2],
        ['c', 3],
      ]),
    )
    compareEvents(newEvents, [{ op: 'add', value: 'c', index: FI.indexNumber(3) }])
  })

  test('add c, d, e at end', () => {
    const previousAgg = FI.aggregateMake(['a', 'b'], FI.fractionalIndexImplNumber)
    const items = ['a', 'b', 'c', 'd', 'e']
    const { newAgg, newEvents } = FI.getNewEvents(previousAgg, items, FI.fractionalIndexImplNumber)
    compareAggregates(
      newAgg,
      FI.aggregateMakeWithIndex([
        ['a', 1],
        ['b', 2],
        ['c', 3],
        ['d', 4],
        ['e', 5],
      ]),
    )
    compareEvents(newEvents, [
      { op: 'add', value: 'c', index: FI.indexNumber(3) },
      { op: 'add', value: 'd', index: FI.indexNumber(4) },
      { op: 'add', value: 'e', index: FI.indexNumber(5) },
    ])
  })

  test('add a at the beginning', () => {
    const previousAgg = FI.aggregateMake(['b', 'c'], FI.fractionalIndexImplNumber)
    const items = ['a', 'b', 'c']
    const { newAgg, newEvents } = FI.getNewEvents(previousAgg, items, FI.fractionalIndexImplNumber)

    compareAggregates(
      newAgg,
      FI.aggregateMakeWithIndex([
        ['a', 0.5],
        ['b', 1],
        ['c', 2],
      ]),
    )

    compareEvents(newEvents, [{ op: 'add', value: 'a', index: FI.indexNumber(0.5) }])
  })
})

describe('remove', () => {
  test('remove a', () => {
    const previousAgg = FI.aggregateMake(['a', 'b', 'c'], FI.fractionalIndexImplNumber)
    const items = ['b', 'c']
    const { newAgg, newEvents } = FI.getNewEvents(previousAgg, items, FI.fractionalIndexImplNumber)
    compareAggregates(
      newAgg,
      FI.aggregateMakeWithIndex([
        ['b', 2],
        ['c', 3],
      ]),
    )
    compareEvents(newEvents, [{ op: 'remove', value: 'a', index: FI.indexNumber(1) }])
  })

  test('remove b', () => {
    const previousAgg = FI.aggregateMake(['a', 'b', 'c'], FI.fractionalIndexImplNumber)
    const items = ['a', 'c']
    const { newAgg, newEvents } = FI.getNewEvents(previousAgg, items, FI.fractionalIndexImplNumber)
    compareAggregates(
      newAgg,
      FI.aggregateMakeWithIndex([
        ['a', 1],
        ['c', 3],
      ]),
    )
    compareEvents(newEvents, [{ op: 'remove', value: 'b', index: FI.indexNumber(2) }])
  })

  test('remove everything', () => {
    const previousAgg = FI.aggregateMake(['a', 'b', 'c'], FI.fractionalIndexImplNumber)
    const { newAgg, newEvents } = FI.getNewEvents(previousAgg, [], FI.fractionalIndexImplNumber)
    compareAggregates(newAgg, FI.aggregateMakeWithIndex([]))
    compareEvents(newEvents, [
      { op: 'remove', value: 'a', index: FI.indexNumber(1) },
      { op: 'remove', value: 'b', index: FI.indexNumber(2) },
      { op: 'remove', value: 'c', index: FI.indexNumber(3) },
    ])
  })
})

describe('move', () => {
  test('switch order of a and b', () => {
    const previousAgg = FI.aggregateMake(['a', 'b'], FI.fractionalIndexImplNumber)
    const items = ['b', 'a']
    const { newAgg, newEvents } = FI.getNewEvents(previousAgg, items, FI.fractionalIndexImplNumber)
    compareAggregates(
      newAgg,
      FI.aggregateMakeWithIndex([
        ['b', 0.5],
        ['a', 1],
      ]),
    )
    compareEvents(newEvents, [
      { op: 'move', value: 'b', newIndex: FI.indexNumber(0.5), previousIndex: FI.indexNumber(2) },
    ])
  })

  test('switch order of a and b with a, b, c', () => {
    const previousAgg = FI.aggregateMake(['a', 'b', 'c'], FI.fractionalIndexImplNumber)
    const items = ['b', 'a', 'c']
    const { newAgg, newEvents } = FI.getNewEvents(previousAgg, items, FI.fractionalIndexImplNumber)
    compareAggregates(
      newAgg,
      FI.aggregateMakeWithIndex([
        ['b', 0.5],
        ['a', 1],
        ['c', 3],
      ]),
    )
    compareEvents(newEvents, [
      { op: 'move', value: 'b', newIndex: FI.indexNumber(0.5), previousIndex: FI.indexNumber(2) },
    ])
  })

  test('move a to after c', () => {
    const previousAgg = FI.aggregateMake(['a', 'b', 'c'], FI.fractionalIndexImplNumber)
    const items = ['b', 'c', 'a']
    const { newAgg, newEvents } = FI.getNewEvents(previousAgg, items, FI.fractionalIndexImplNumber)
    compareAggregates(
      newAgg,
      FI.aggregateMakeWithIndex([
        ['b', 2],
        ['c', 3],
        ['a', 4],
      ]),
    )
    compareEvents(newEvents, [
      { op: 'move', value: 'a', newIndex: FI.indexNumber(4), previousIndex: FI.indexNumber(1) },
    ])
  })

  test('move d to beginning', () => {
    const previousAgg = FI.aggregateMake(['a', 'b', 'c', 'd'], FI.fractionalIndexImplNumber)
    const items = ['d', 'a', 'b', 'c']
    const { newAgg, newEvents } = FI.getNewEvents(previousAgg, items, FI.fractionalIndexImplNumber)
    compareAggregates(
      newAgg,
      FI.aggregateMakeWithIndex([
        ['d', 0.5],
        ['a', 1],
        ['b', 2],
        ['c', 3],
      ]),
    )
    compareEvents(newEvents, [
      { op: 'move', value: 'd', newIndex: FI.indexNumber(0.5), previousIndex: FI.indexNumber(4) },
    ])
  })

  test('move b to the end in [a, b, c]', () => {
    const previousAgg = FI.aggregateMake(['a', 'b', 'c'], FI.fractionalIndexImplNumber)
    const items = ['a', 'c', 'b']
    const { newAgg, newEvents } = FI.getNewEvents(previousAgg, items, FI.fractionalIndexImplNumber)
    compareAggregates(
      newAgg,
      FI.aggregateMakeWithIndex([
        ['a', 1],
        ['c', 1.5],
        ['b', 2],
      ]),
    )
    compareEvents(newEvents, [
      { op: 'move', value: 'c', newIndex: FI.indexNumber(1.5), previousIndex: FI.indexNumber(3) },
    ])
  })

  test('move b to the end in [a, b, c, c]', () => {
    const previousAgg = FI.aggregateMake(['a', 'b', 'c', 'c'], FI.fractionalIndexImplNumber)
    const items = ['a', 'c', 'c', 'b']
    const { newAgg, newEvents } = FI.getNewEvents(previousAgg, items, FI.fractionalIndexImplNumber)
    compareAggregates(
      newAgg,
      FI.aggregateMakeWithIndex([
        ['a', 1],
        ['c', 3],
        ['c', 4],
        ['b', 5],
      ]),
    )
    compareEvents(newEvents, [
      { op: 'move', value: 'b', newIndex: FI.indexNumber(5), previousIndex: FI.indexNumber(2) },
    ])
  })

  test('move b further back in [a, b, c, d, e]', () => {
    const previousAgg = FI.aggregateMake(['a', 'b', 'c', 'd', 'e'], FI.fractionalIndexImplNumber)
    const items = ['a', 'c', 'd', 'b', 'e']
    const { newAgg, newEvents } = FI.getNewEvents(previousAgg, items, FI.fractionalIndexImplNumber)
    compareAggregates(
      newAgg,
      FI.aggregateMakeWithIndex([
        ['a', 1],
        ['c', 3],
        ['d', 4],
        ['b', 4.5],
        ['e', 5],
      ]),
    )
    compareEvents(newEvents, [
      { op: 'move', value: 'b', newIndex: FI.indexNumber(4.5), previousIndex: FI.indexNumber(2) },
    ])
  })
})

describe('mix', () => {
  test('move a to after c and add d', () => {
    const previousAgg = FI.aggregateMake(['a', 'b', 'c'], FI.fractionalIndexImplNumber)
    const items = ['b', 'c', 'a', 'd']
    const { newAgg, newEvents } = FI.getNewEvents(previousAgg, items, FI.fractionalIndexImplNumber)
    compareAggregates(
      newAgg,
      FI.aggregateMakeWithIndex([
        ['b', 2],
        ['c', 3],
        ['a', 4],
        ['d', 5],
      ]),
    )
    compareEvents(newEvents, [
      { op: 'move', value: 'a', newIndex: FI.indexNumber(4), previousIndex: FI.indexNumber(1) },
      { op: 'add', value: 'd', index: FI.indexNumber(5) },
    ])
  })

  test('move a to after c', () => {
    const previousAgg = FI.aggregateMake(['a', 'b', 'c', 'd', 'e'], FI.fractionalIndexImplNumber)
    const items = ['b', 'c', 'a', 'd', 'f']
    const { newAgg, newEvents } = FI.getNewEvents(previousAgg, items, FI.fractionalIndexImplNumber)
    compareAggregates(
      newAgg,
      FI.aggregateMakeWithIndex([
        ['b', 2],
        ['c', 3],
        ['a', 3.5],
        ['d', 4],
        ['f', 4.5],
      ]),
    )
    compareEvents(newEvents, [
      { op: 'move', value: 'a', newIndex: FI.indexNumber(3.5), previousIndex: FI.indexNumber(1) },
      { op: 'add', value: 'f', index: FI.indexNumber(4.5) },
      { op: 'remove', value: 'e', index: FI.indexNumber(5) },
    ])
  })

  test('remove b and move a to after c and add d', () => {
    const previousAgg = FI.aggregateMake(['a', 'b', 'c'], FI.fractionalIndexImplNumber)
    const items = ['c', 'a', 'd']
    const { newAgg, newEvents } = FI.getNewEvents(previousAgg, items, FI.fractionalIndexImplNumber)
    compareAggregates(
      newAgg,
      FI.aggregateMakeWithIndex([
        ['c', 0.5],
        ['a', 1],
        ['d', 4],
      ]),
    )
    compareEvents(newEvents, [
      { op: 'move', value: 'c', newIndex: FI.indexNumber(0.5), previousIndex: FI.indexNumber(3) },
      { op: 'add', value: 'd', index: FI.indexNumber(4) },
      { op: 'remove', value: 'b', index: FI.indexNumber(2) },
    ])
  })

  test('remove b and move a to after c and add d', () => {
    const previousAgg = FI.aggregateMake(['a', 'b', 'c', 'e'], FI.fractionalIndexImplNumber)
    const items = ['c', 'a', 'd', 'e']
    const { newAgg, newEvents } = FI.getNewEvents(previousAgg, items, FI.fractionalIndexImplNumber)
    compareAggregates(
      newAgg,
      FI.aggregateMakeWithIndex([
        ['c', 0.5],
        ['a', 1],
        ['d', 2.5],
        ['e', 4],
      ]),
    )
    compareEvents(newEvents, [
      { op: 'move', value: 'c', newIndex: FI.indexNumber(0.5), previousIndex: FI.indexNumber(3) },
      { op: 'add', value: 'd', index: FI.indexNumber(2.5) },
      { op: 'remove', value: 'b', index: FI.indexNumber(2) },
    ])
  })

  test('snapshot', () => {
    const previousAgg = FI.aggregateMake(
      [
        'spotify:track:0TznIFpOhfECa93BCUNnH0',
        'spotify:track:24mCtp8VWK4E4oGA37bA96',
        'spotify:track:4norb7PlGa1K7AVy26ODUT',
        'spotify:track:0OijABrqIE3h6iDcDjLagm',
        'spotify:track:7BrkQVx3P9bDtjiYYF91tx',
        'spotify:track:3m7yvp6LBkpUGsSMTy8NX2',
        'spotify:track:2dvf91VQ1Dd6n5cQ62r7wi',
        'spotify:track:2lzCpfLxJD75ie2GvBURls',
        'spotify:track:5RBUNtzNiA5yNudrRGmsTF',
        'spotify:track:7ec1cAEJwhWP4uhq1R3kZH',
        'spotify:track:4Z1aWDyzDcEM1IOXbqLsmL',
        'spotify:track:56825K0oCzxsYY1mkP9Uva',
        'spotify:track:6ujwcSNqTkQBwR8sJUABaZ',
        'spotify:track:0a4GdJi2TAYv2GvwX5svhK',
        'spotify:track:0cHnVHkrcCqAJdC1mgkbhk',
        'spotify:track:0pRIs6EFRLniTBxEsR0g0g',
        'spotify:track:0FzBc9ZOUxC5UzoVNdBSUU',
        'spotify:track:1bd3gbhwB0ivOmKG3m9gLP',
        'spotify:track:1h0XDcj7u7qBvnh2AdDcgL',
        'spotify:track:1xnazYas0VlhuKOPkp5ChN',
        'spotify:track:2100n8MMswsdlDzNYIyCxO',
        'spotify:track:5eFI4a7q8Ln0HDZ0lbIPhr',
        'spotify:track:5roCaN1hCmT4EheCLxcq8G',
        'spotify:track:67tBxVnhnvuCiPJrZXHh4b',
        'spotify:track:0W5M1G8UKZCEmE87UiwWZu',
        'spotify:track:3Irlpo7wQwGFcKEDs6wQGe',
        'spotify:track:5Y8LjJ9Riiw8i5d6D06fYS',
        'spotify:track:0uJulymzzSoivKLuUftBh0',
        'spotify:track:6b1Cb7U47btfQbL7R4qOBQ',
        'spotify:track:7AVHYVUUTusrL4zPSekFfT',
        'spotify:track:3XJ0awPCBxNPlYtQYPW8Gb',
        'spotify:track:5jHzYWfxlXhQyTa8mM0eO2',
        'spotify:track:3jLgWmtdem25E64GlVUhDw',
        'spotify:track:3uD5J1ZKtr3edjIAlm36sT',
        'spotify:track:6wzS6QmMqHn7ek3wJIO6Oj',
        'spotify:track:4GXzTiz5XDhEcPDtAgCFtu',
        'spotify:track:2QDWH5GSx00RSF8UN13O7v',
        'spotify:track:2mioFVFyXbANMZ0PcHE9tx',
        'spotify:track:3iuwADUH0uNWNDzvpqgEnW',
        'spotify:track:1hjoYeRwkAbaqY3Akt6wHm',
        'spotify:track:6qoWzWhE6L6VTS1xIX2ewf',
        'spotify:track:7ecjhVG4TteF73lWabR74s',
        'spotify:track:0D6a3qW0WK6w9v4bRhuJQi',
        'spotify:track:37wgChKCfQCTZhdHvcnvLk',
        'spotify:track:7w6mwTLd5Zg5fZjQ0ACnRG',
        'spotify:track:2I5mFchVvh7G0GYwP0shTn',
        'spotify:track:09PT7vRV8WOjogX7oPb37H',
        'spotify:track:2OaQSjSbztTEuCxtBpClvO',
        'spotify:track:4lWfB5KS6t5WRSEMZe3yY5',
        'spotify:track:4VHrgyMrSuf4MzJhzqnXYP',
        'spotify:track:6oTo8e7rz1bEPvxD9Vktxc',
        'spotify:track:1fgHmb5GNFwHelhoPydwKz',
        'spotify:track:0mvxAh7MFqRmpK395mOClC',
        'spotify:track:6x6KyIlS31D8sHYyuxt3Iy',
        'spotify:track:6uU17x35XODQYohTpQKj97',
        'spotify:track:0THt7LNNLZMjql3262xl3u',
        'spotify:track:6sor7oMwQiGKBNxh5BWqnf',
      ],
      FI.fractionalIndexImplNumber,
    )

    const items = [
      'spotify:track:2B95kb9DYJwixkE6lTX0od',
      'spotify:track:24mCtp8VWK4E4oGA37bA96',
      'spotify:track:4norb7PlGa1K7AVy26ODUT',
      'spotify:track:0OijABrqIE3h6iDcDjLagm',
      'spotify:track:7BrkQVx3P9bDtjiYYF91tx',
      'spotify:track:3m7yvp6LBkpUGsSMTy8NX2',
      'spotify:track:2dvf91VQ1Dd6n5cQ62r7wi',
      'spotify:track:2lzCpfLxJD75ie2GvBURls',
      'spotify:track:5RBUNtzNiA5yNudrRGmsTF',
      'spotify:track:7ec1cAEJwhWP4uhq1R3kZH',
      'spotify:track:4Z1aWDyzDcEM1IOXbqLsmL',
      'spotify:track:6ujwcSNqTkQBwR8sJUABaZ',
      'spotify:track:0a4GdJi2TAYv2GvwX5svhK',
      'spotify:track:0cHnVHkrcCqAJdC1mgkbhk',
      'spotify:track:0pRIs6EFRLniTBxEsR0g0g',
      'spotify:track:0FzBc9ZOUxC5UzoVNdBSUU',
      'spotify:track:1bd3gbhwB0ivOmKG3m9gLP',
      'spotify:track:1xnazYas0VlhuKOPkp5ChN',
      'spotify:track:2100n8MMswsdlDzNYIyCxO',
      'spotify:track:5eFI4a7q8Ln0HDZ0lbIPhr',
      'spotify:track:5roCaN1hCmT4EheCLxcq8G',
      'spotify:track:67tBxVnhnvuCiPJrZXHh4b',
      'spotify:track:0W5M1G8UKZCEmE87UiwWZu',
      'spotify:track:3Irlpo7wQwGFcKEDs6wQGe',
      'spotify:track:5Y8LjJ9Riiw8i5d6D06fYS',
      'spotify:track:0uJulymzzSoivKLuUftBh0',
      'spotify:track:6b1Cb7U47btfQbL7R4qOBQ',
      'spotify:track:7AVHYVUUTusrL4zPSekFfT',
      'spotify:track:3XJ0awPCBxNPlYtQYPW8Gb',
      'spotify:track:5jHzYWfxlXhQyTa8mM0eO2',
      'spotify:track:3jLgWmtdem25E64GlVUhDw',
      'spotify:track:3uD5J1ZKtr3edjIAlm36sT',
      'spotify:track:6wzS6QmMqHn7ek3wJIO6Oj',
      'spotify:track:4GXzTiz5XDhEcPDtAgCFtu',
      'spotify:track:2QDWH5GSx00RSF8UN13O7v',
      'spotify:track:2mioFVFyXbANMZ0PcHE9tx',
      'spotify:track:3iuwADUH0uNWNDzvpqgEnW',
      'spotify:track:1hjoYeRwkAbaqY3Akt6wHm',
      'spotify:track:6qoWzWhE6L6VTS1xIX2ewf',
      'spotify:track:7ecjhVG4TteF73lWabR74s',
      'spotify:track:0tbe6Xt8n3LnJDEJ6crl72',
      'spotify:track:37wgChKCfQCTZhdHvcnvLk',
      'spotify:track:7w6mwTLd5Zg5fZjQ0ACnRG',
      'spotify:track:2I5mFchVvh7G0GYwP0shTn',
      'spotify:track:09PT7vRV8WOjogX7oPb37H',
      'spotify:track:2OaQSjSbztTEuCxtBpClvO',
      'spotify:track:4lWfB5KS6t5WRSEMZe3yY5',
      'spotify:track:4VHrgyMrSuf4MzJhzqnXYP',
      'spotify:track:6oTo8e7rz1bEPvxD9Vktxc',
      'spotify:track:1fgHmb5GNFwHelhoPydwKz',
      'spotify:track:0mvxAh7MFqRmpK395mOClC',
      'spotify:track:6x6KyIlS31D8sHYyuxt3Iy',
      'spotify:track:6uU17x35XODQYohTpQKj97',
      'spotify:track:0THt7LNNLZMjql3262xl3u',
      'spotify:track:6sor7oMwQiGKBNxh5BWqnf',
    ]
    const { newAgg, newEvents } = FI.getNewEvents(previousAgg, items, FI.fractionalIndexImplNumber)

    expect(newAgg).toMatchInlineSnapshot(`
      [
        {
          "index": 0.5,
          "value": "spotify:track:2B95kb9DYJwixkE6lTX0od",
        },
        {
          "index": 2,
          "value": "spotify:track:24mCtp8VWK4E4oGA37bA96",
        },
        {
          "index": 3,
          "value": "spotify:track:4norb7PlGa1K7AVy26ODUT",
        },
        {
          "index": 4,
          "value": "spotify:track:0OijABrqIE3h6iDcDjLagm",
        },
        {
          "index": 5,
          "value": "spotify:track:7BrkQVx3P9bDtjiYYF91tx",
        },
        {
          "index": 6,
          "value": "spotify:track:3m7yvp6LBkpUGsSMTy8NX2",
        },
        {
          "index": 7,
          "value": "spotify:track:2dvf91VQ1Dd6n5cQ62r7wi",
        },
        {
          "index": 8,
          "value": "spotify:track:2lzCpfLxJD75ie2GvBURls",
        },
        {
          "index": 9,
          "value": "spotify:track:5RBUNtzNiA5yNudrRGmsTF",
        },
        {
          "index": 10,
          "value": "spotify:track:7ec1cAEJwhWP4uhq1R3kZH",
        },
        {
          "index": 11,
          "value": "spotify:track:4Z1aWDyzDcEM1IOXbqLsmL",
        },
        {
          "index": 13,
          "value": "spotify:track:6ujwcSNqTkQBwR8sJUABaZ",
        },
        {
          "index": 14,
          "value": "spotify:track:0a4GdJi2TAYv2GvwX5svhK",
        },
        {
          "index": 15,
          "value": "spotify:track:0cHnVHkrcCqAJdC1mgkbhk",
        },
        {
          "index": 16,
          "value": "spotify:track:0pRIs6EFRLniTBxEsR0g0g",
        },
        {
          "index": 17,
          "value": "spotify:track:0FzBc9ZOUxC5UzoVNdBSUU",
        },
        {
          "index": 18,
          "value": "spotify:track:1bd3gbhwB0ivOmKG3m9gLP",
        },
        {
          "index": 20,
          "value": "spotify:track:1xnazYas0VlhuKOPkp5ChN",
        },
        {
          "index": 21,
          "value": "spotify:track:2100n8MMswsdlDzNYIyCxO",
        },
        {
          "index": 22,
          "value": "spotify:track:5eFI4a7q8Ln0HDZ0lbIPhr",
        },
        {
          "index": 23,
          "value": "spotify:track:5roCaN1hCmT4EheCLxcq8G",
        },
        {
          "index": 24,
          "value": "spotify:track:67tBxVnhnvuCiPJrZXHh4b",
        },
        {
          "index": 25,
          "value": "spotify:track:0W5M1G8UKZCEmE87UiwWZu",
        },
        {
          "index": 26,
          "value": "spotify:track:3Irlpo7wQwGFcKEDs6wQGe",
        },
        {
          "index": 27,
          "value": "spotify:track:5Y8LjJ9Riiw8i5d6D06fYS",
        },
        {
          "index": 28,
          "value": "spotify:track:0uJulymzzSoivKLuUftBh0",
        },
        {
          "index": 29,
          "value": "spotify:track:6b1Cb7U47btfQbL7R4qOBQ",
        },
        {
          "index": 30,
          "value": "spotify:track:7AVHYVUUTusrL4zPSekFfT",
        },
        {
          "index": 31,
          "value": "spotify:track:3XJ0awPCBxNPlYtQYPW8Gb",
        },
        {
          "index": 32,
          "value": "spotify:track:5jHzYWfxlXhQyTa8mM0eO2",
        },
        {
          "index": 33,
          "value": "spotify:track:3jLgWmtdem25E64GlVUhDw",
        },
        {
          "index": 34,
          "value": "spotify:track:3uD5J1ZKtr3edjIAlm36sT",
        },
        {
          "index": 35,
          "value": "spotify:track:6wzS6QmMqHn7ek3wJIO6Oj",
        },
        {
          "index": 36,
          "value": "spotify:track:4GXzTiz5XDhEcPDtAgCFtu",
        },
        {
          "index": 37,
          "value": "spotify:track:2QDWH5GSx00RSF8UN13O7v",
        },
        {
          "index": 38,
          "value": "spotify:track:2mioFVFyXbANMZ0PcHE9tx",
        },
        {
          "index": 39,
          "value": "spotify:track:3iuwADUH0uNWNDzvpqgEnW",
        },
        {
          "index": 40,
          "value": "spotify:track:1hjoYeRwkAbaqY3Akt6wHm",
        },
        {
          "index": 41,
          "value": "spotify:track:6qoWzWhE6L6VTS1xIX2ewf",
        },
        {
          "index": 42,
          "value": "spotify:track:7ecjhVG4TteF73lWabR74s",
        },
        {
          "index": 42.5,
          "value": "spotify:track:0tbe6Xt8n3LnJDEJ6crl72",
        },
        {
          "index": 44,
          "value": "spotify:track:37wgChKCfQCTZhdHvcnvLk",
        },
        {
          "index": 45,
          "value": "spotify:track:7w6mwTLd5Zg5fZjQ0ACnRG",
        },
        {
          "index": 46,
          "value": "spotify:track:2I5mFchVvh7G0GYwP0shTn",
        },
        {
          "index": 47,
          "value": "spotify:track:09PT7vRV8WOjogX7oPb37H",
        },
        {
          "index": 48,
          "value": "spotify:track:2OaQSjSbztTEuCxtBpClvO",
        },
        {
          "index": 49,
          "value": "spotify:track:4lWfB5KS6t5WRSEMZe3yY5",
        },
        {
          "index": 50,
          "value": "spotify:track:4VHrgyMrSuf4MzJhzqnXYP",
        },
        {
          "index": 51,
          "value": "spotify:track:6oTo8e7rz1bEPvxD9Vktxc",
        },
        {
          "index": 52,
          "value": "spotify:track:1fgHmb5GNFwHelhoPydwKz",
        },
        {
          "index": 53,
          "value": "spotify:track:0mvxAh7MFqRmpK395mOClC",
        },
        {
          "index": 54,
          "value": "spotify:track:6x6KyIlS31D8sHYyuxt3Iy",
        },
        {
          "index": 55,
          "value": "spotify:track:6uU17x35XODQYohTpQKj97",
        },
        {
          "index": 56,
          "value": "spotify:track:0THt7LNNLZMjql3262xl3u",
        },
        {
          "index": 57,
          "value": "spotify:track:6sor7oMwQiGKBNxh5BWqnf",
        },
      ]
    `)
    expect(newEvents).toMatchInlineSnapshot(`
      [
        {
          "index": 0.5,
          "op": "add",
          "value": "spotify:track:2B95kb9DYJwixkE6lTX0od",
        },
        {
          "index": 42.5,
          "op": "add",
          "value": "spotify:track:0tbe6Xt8n3LnJDEJ6crl72",
        },
        {
          "index": 1,
          "op": "remove",
          "value": "spotify:track:0TznIFpOhfECa93BCUNnH0",
        },
        {
          "index": 12,
          "op": "remove",
          "value": "spotify:track:56825K0oCzxsYY1mkP9Uva",
        },
        {
          "index": 19,
          "op": "remove",
          "value": "spotify:track:1h0XDcj7u7qBvnh2AdDcgL",
        },
        {
          "index": 43,
          "op": "remove",
          "value": "spotify:track:0D6a3qW0WK6w9v4bRhuJQi",
        },
      ]
    `)
  })
})

describe('string-indexes', () => {
  test('move a to after c and add d', () => {
    const previousAgg = FI.aggregateMake(['a', 'b', 'c'], FI.indexStringImpl)
    const items = ['b', 'c', 'a', 'd']
    const { newAgg, newEvents } = FI.getNewEvents(previousAgg, items, FI.indexStringImpl)
    compareAggregates(newAgg, [
      { value: 'b', index: FI.indexString('a3') },
      { value: 'c', index: FI.indexString('a4') },
      { value: 'a', index: FI.indexString('a5') },
      { value: 'd', index: FI.indexString('a6') },
    ])
    compareEvents(newEvents, [
      {
        op: 'move',
        value: 'a',
        newIndex: FI.indexString('a5'),
        previousIndex: FI.indexString('a2'),
      },
      { op: 'add', value: 'd', index: FI.indexString('a6') },
    ])
  })

  test('add a to agg with b, c', () => {
    const previousAgg = FI.aggregateMake(['b', 'c'], FI.indexStringImpl)
    const items = ['a', 'b', 'c']
    const { newAgg, newEvents } = FI.getNewEvents(previousAgg, items, FI.indexStringImpl)
    compareAggregates(newAgg, [
      { value: 'a', index: FI.indexString('a1V') },
      { value: 'b', index: FI.indexString('a2') },
      { value: 'c', index: FI.indexString('a3') },
    ])
    compareEvents(newEvents, [{ op: 'add', value: 'a', index: FI.indexString('a1V') }])
  })
})

describe('duplicates', () => {
  test('add another a to a', () => {
    const previousAgg = FI.aggregateMake(['a'], FI.fractionalIndexImplNumber)
    const items = ['a', 'a']
    const { newAgg, newEvents } = FI.getNewEvents(previousAgg, items, FI.fractionalIndexImplNumber)
    compareAggregates(
      newAgg,
      FI.aggregateMakeWithIndex([
        ['a', 1],
        ['a', 2],
      ]),
    )
    compareEvents(newEvents, [{ op: 'add', value: 'a', index: FI.indexNumber(2) }])
  })

  test('add another a to a, b', () => {
    const previousAgg = FI.aggregateMake(['a', 'b'], FI.fractionalIndexImplNumber)
    const items = ['a', 'b', 'a']
    const { newAgg, newEvents } = FI.getNewEvents(previousAgg, items, FI.fractionalIndexImplNumber)
    compareAggregates(
      newAgg,
      FI.aggregateMakeWithIndex([
        ['a', 1],
        ['b', 2],
        ['a', 3],
      ]),
    )
    compareEvents(newEvents, [{ op: 'add', value: 'a', index: FI.indexNumber(3) }])
  })

  test('remove one b of multiple b', () => {
    const previousAgg = FI.aggregateMake(['b', 'a', 'b', 'b'], FI.fractionalIndexImplNumber)
    const items = ['b', 'a', 'b']
    const { newAgg, newEvents } = FI.getNewEvents(previousAgg, items, FI.fractionalIndexImplNumber)
    compareAggregates(
      newAgg,
      FI.aggregateMakeWithIndex([
        ['b', 1],
        ['a', 2],
        ['b', 3],
      ]),
    )
    compareEvents(newEvents, [{ op: 'remove', value: 'b', index: FI.indexNumber(4) }])
  })

  test('remove one a from a, a, b', () => {
    const previousAgg = FI.aggregateMake(['a', 'a', 'b'], FI.fractionalIndexImplNumber)
    const items = ['a', 'b']
    const { newAgg, newEvents } = FI.getNewEvents(previousAgg, items, FI.fractionalIndexImplNumber)
    compareAggregates(
      newAgg,
      FI.aggregateMakeWithIndex([
        ['a', 1],
        ['b', 3],
      ]),
    )
    compareEvents(newEvents, [{ op: 'remove', value: 'a', index: FI.indexNumber(2) }])
  })
})

describe('non-scalar values', () => {
  test('move (a,a) to after (c,c) and add (d,d)', () => {
    const tp = (_: string) => [_, _]
    const previousAgg = FI.aggregateMake([tp('a'), tp('b'), tp('c')], FI.fractionalIndexImplNumber)
    const items = [tp('b'), tp('c'), tp('a'), tp('d')]
    const { newAgg, newEvents } = FI.getNewEvents(
      previousAgg,
      items,
      FI.fractionalIndexImplNumber,
      (a, b) => a[0] === b[0] && a[1] === b[1],
    )
    compareAggregates(
      newAgg,
      FI.aggregateMakeWithIndex([
        [tp('b'), 2],
        [tp('c'), 3],
        [tp('a'), 4],
        [tp('d'), 5],
      ]),
    )
    compareEvents(newEvents, [
      { op: 'move', value: tp('a'), newIndex: FI.indexNumber(4), previousIndex: FI.indexNumber(1) },
      { op: 'add', value: tp('d'), index: FI.indexNumber(5) },
    ])
  })
})

const compareAggregates = <T, TFractionalIndex>(
  given: FI.Aggregate<T, TFractionalIndex>,
  expected: FI.Aggregate<T, TFractionalIndex>,
) => {
  expect(given).toEqual(expected)
}

const compareEvents = <T, TFractionalIndex>(
  given: ReadonlyArray<FI.Event<T, TFractionalIndex>>,
  expected: ReadonlyArray<FI.Event<T, TFractionalIndex>>,
) => {
  expect(given).toEqual(expected)
}
