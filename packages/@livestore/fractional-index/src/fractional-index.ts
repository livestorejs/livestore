import { shouldNeverHappen } from '@livestore/utils'
import { Brand, Channel, Chunk, Effect, Option, pipe, Schema, Stream } from '@livestore/utils/effect'

// NOTE unfortunately both implementations have a bug re trailing zeros
// TODO either fix the bug or find a better implementation
import * as impl from './indexes/dgreensp.js'
// import * as impl from './indexes/rocicorp.js'

export type IndexNumber = Brand.Branded<number, 'FractionalIndexNumber'>
export const indexNumber = Brand.nominal<IndexNumber>()
export const indexNumberSchema = Schema.fromBrand(indexNumber)(Schema.number)

interface FractionalIndexImpl<TVal> {
  smallest: TVal
  midpoint: (a: TVal, b: TVal) => TVal
  increment: (a: TVal) => TVal
  decrement: (a: TVal) => TVal
}

export const fractionalIndexImplNumber: FractionalIndexImpl<IndexNumber> = {
  smallest: indexNumber(0),
  midpoint: (a, b) => indexNumber((a + b) / 2),
  increment: (a) => indexNumber(Math.ceil(a + 1)),
  decrement: (a) => indexNumber(Math.floor(a - 1)),
}

export type IndexString = Brand.Branded<string, 'FractionalIndexString'>
export const indexString = Brand.nominal<IndexString>()
export const indexStringSchema = Schema.fromBrand(indexString)(Schema.string)

export const indexStringImpl: FractionalIndexImpl<IndexString> = {
  smallest: indexString('a1'),
  midpoint: (a, b) => indexString(impl.midpoint(a, b)),
  increment: (a) => indexString(impl.incrementInteger(a) ?? shouldNeverHappen(`Invalid index ${a}`)),
  decrement: (a) => indexString(impl.decrementInteger(a) ?? shouldNeverHappen(`Invalid index ${a}`)),
}

export const generateNStringIndexes = (n: number): ReadonlyArray<IndexString> =>
  impl.generateNKeysBetween('a1', undefined, n).map(indexString)

export const midpointStringIndexes = (a: IndexString, b: IndexString): IndexString => indexString(impl.midpoint(a, b))

export const incrementStringIndex = (a: IndexString): IndexString => indexString(impl.incrementInteger(a)!)

export type AggregateItem<T, TFractionalIndex> = {
  value: T
  index: TFractionalIndex
}
export type Aggregate<T, TFractionalIndex> = ReadonlyArray<AggregateItem<T, TFractionalIndex>>

export type Event<T, TFractionalIndex> =
  | EventAdd<T, TFractionalIndex>
  | EventRemove<T, TFractionalIndex>
  | EventMove<T, TFractionalIndex>

export type EventAdd<T, TFractionalIndex> = {
  op: 'add'
  value: T
  index: TFractionalIndex
}
export type EventMove<T, TFractionalIndex> = {
  op: 'move'
  value: T
  previousIndex: TFractionalIndex
  newIndex: TFractionalIndex
}
export type EventRemove<T, TFractionalIndex> = {
  op: 'remove'
  value: T
  index: TFractionalIndex
}

export const isEvent = <T, TFractionalIndex>(
  event: Event<T, TFractionalIndex> | Aggregate<T, any> | null,
): event is Event<T, TFractionalIndex> =>
  typeof event === 'object' && event !== null && 'op' in event && ['add', 'move', 'remove'].includes((event as any).op)

export type BuildResult<T, TFractionalIndex> = {
  newAgg: Aggregate<T, TFractionalIndex>
  newEvents: ReadonlyArray<Event<T, TFractionalIndex>>
}

export const getNewEventsStream = <C, E, A, TFractionalIndex extends number | string>(
  previousItemsAgg: Aggregate<A, TFractionalIndex>,
  newItems: Stream.Stream<A, E, C>,
  fractionalIndexImpl: FractionalIndexImpl<TFractionalIndex>,
  areEqual: (a: A, b: A) => boolean = (a, b) => a === b,
): Stream.Stream<Event<A, TFractionalIndex> | Aggregate<A, TFractionalIndex>, E, C> => {
  return Stream.suspend(() => {
    const newItemsAgg = new Array<AggregateItem<A, TFractionalIndex>>()

    // Initially all items are unused (we gradually remove them from this array)
    const previousUnusedItemsAgg = previousItemsAgg.slice()
    const previousUnusedItemsAggStash = new Array<AggregateItem<A, TFractionalIndex>>()

    const usedFractionalIndexes = new Set<TFractionalIndex>(previousItemsAgg.map((item) => item.index))

    let lastUsedFractionalIndex = fractionalIndexImpl.smallest

    // NOTE we could also consider making `loop(params)` with immutable
    const loop: Channel.Channel<
      Chunk.Chunk<Event<A, TFractionalIndex> | Aggregate<A, TFractionalIndex>>,
      Chunk.Chunk<A>,
      never,
      never
    > = Channel.readWith({
      onInput: (newItems: Chunk.Chunk<A>) => {
        const newEventsChunk =
          /**
           * Invariants:
           * - `newItemsAgg` and `newItems` are equivalent up to the last iteration loop index
           * - `previousUnusedItemsAgg` and `previousUnusedItemsAggStash` are sorted by fractional `.index`
           * - ...
           */
          Chunk.filterMap(newItems, (itemValue, newItemIndex) => {
            // console.log('\n', itemValue, newItems.length)

            // TODO double check whether this is a valid assumption (e.g. whether indexes are alright)
            if (previousUnusedItemsAgg[0]?.value === itemValue) {
              const itemAgg = previousUnusedItemsAgg.shift()!
              newItemsAgg.push(itemAgg)
              lastUsedFractionalIndex = itemAgg.index
              return Option.none()
            }

            const tryToGetItemFromPreviousItemsAgg = ():
              | { itemAgg: AggregateItem<A, TFractionalIndex>; wasInStash: false }
              | { itemAgg: AggregateItem<A, TFractionalIndex>; wasInStash: boolean }
              | { itemAgg: undefined; wasInStash: false } => {
              // First we're trying to find the item in the stash
              const itemAggStashIndex = previousUnusedItemsAggStash.findIndex((item) => areEqual(item.value, itemValue))

              if (itemAggStashIndex !== -1) {
                return {
                  itemAgg: previousUnusedItemsAggStash.splice(itemAggStashIndex, 1)[0]!,
                  wasInStash: true,
                }
              }

              // Assuming we didn't find the item in the stash,
              // we're trying to find the item in previous items
              const itemAggIndex = previousUnusedItemsAgg.findIndex((item) => areEqual(item.value, itemValue))

              // In case we eventually find a matching item,
              // we're stashing all different items up to the next matching item
              if (itemAggIndex > 0) {
                const stashedItemsAgg = previousUnusedItemsAgg.splice(0, itemAggIndex)
                previousUnusedItemsAggStash.push(...stashedItemsAgg)
                const itemAgg = previousUnusedItemsAgg.shift()!
                // console.log('stashing', { itemAggIndex, previousUnusedItemsAgg, previousUnusedItemsAggStash })

                return { itemAgg, wasInStash: false }
              }

              if (itemAggIndex !== -1) {
                return { itemAgg: previousUnusedItemsAgg.shift()!, wasInStash: false }
              }

              return { itemAgg: undefined, wasInStash: false }
            }

            const { itemAgg, wasInStash } = tryToGetItemFromPreviousItemsAgg()

            if (wasInStash === true && itemAgg.index > lastUsedFractionalIndex) {
              lastUsedFractionalIndex = itemAgg.index
              newItemsAgg.push(itemAgg)
              return Option.none()
            }

            const nextNewItemValue = pipe(Chunk.get(newItems, newItemIndex + 1), Option.getOrUndefined)
            const currentPreviousItemValue = previousItemsAgg[newItemIndex]?.value
            const nextNewItemMatchesCurrentPrevious = nextNewItemValue === currentPreviousItemValue

            /** This assumes `previousUnusedItemsAgg` is sorted by `.index` */
            const smallestNextFracIndex = nextNewItemMatchesCurrentPrevious
              ? previousItemsAgg[newItemIndex]?.index
              : itemAgg !== undefined && wasInStash === false
                ? itemAgg.index
                : previousUnusedItemsAgg.at(0)?.index

            // console.log({
            //   smallestNextFracIndex,
            //   lastUsedFractionalIndex,
            //   itemAggIdx: itemAgg?.index,
            //   nextNewItemMatchesCurrentPrevious,
            //   lowestStashedIndex,
            //   wasInStash,
            // })

            const getNextUnusedFractionalIndex = () => {
              let nextUnusedFractionalIndex = lastUsedFractionalIndex
              while (true) {
                nextUnusedFractionalIndex = fractionalIndexImpl.increment(nextUnusedFractionalIndex)
                if (usedFractionalIndexes.has(nextUnusedFractionalIndex)) {
                  continue
                }

                return nextUnusedFractionalIndex
              }
            }

            const fracIndex = smallestNextFracIndex
              ? fractionalIndexImpl.midpoint(lastUsedFractionalIndex, smallestNextFracIndex)
              : getNextUnusedFractionalIndex()

            if (itemAgg === undefined) {
              // add
              newItemsAgg.push({ value: itemValue, index: fracIndex })
              lastUsedFractionalIndex = fracIndex

              if (usedFractionalIndexes.has(fracIndex)) {
                return shouldNeverHappen(`Fractional index ${fracIndex} is already used`)
              }
              usedFractionalIndexes.add(fracIndex)

              return Option.some({ op: 'add', value: itemValue, index: fracIndex } satisfies Event<A, TFractionalIndex>)
            } else {
              if (
                (itemAgg.index === smallestNextFracIndex || smallestNextFracIndex === undefined) &&
                itemAgg.index > lastUsedFractionalIndex
              ) {
                // order is fine
                newItemsAgg.push(itemAgg)
                lastUsedFractionalIndex = itemAgg.index

                return Option.none<Event<A, TFractionalIndex>>()
              } else {
                // move
                newItemsAgg.push({ value: itemValue, index: fracIndex })
                lastUsedFractionalIndex = fracIndex
                if (usedFractionalIndexes.has(fracIndex)) {
                  throw new Error(`Fractional index ${fracIndex} is already used`)
                }
                usedFractionalIndexes.add(fracIndex)

                return Option.some({
                  op: 'move',
                  value: itemValue,
                  newIndex: fracIndex,
                  previousIndex: itemAgg.index,
                } satisfies Event<A, TFractionalIndex>)
              }
            }
          })

        return pipe(
          Channel.write(newEventsChunk),
          Channel.flatMap(() => loop),
        )
      },
      onFailure: Channel.fail,
      onDone: () => {
        const removeEvents = previousUnusedItemsAggStash
          .concat(previousUnusedItemsAgg)
          .map(({ index, value }) => ({ op: 'remove', index, value }) satisfies Event<A, TFractionalIndex>)
        return pipe(
          Channel.write(Chunk.fromIterable(removeEvents)),
          Channel.zipRight(Channel.write(Chunk.of(newItemsAgg))),
          Channel.zipRight(Channel.succeed(void 0)),
        )
      },
    })

    return pipe(Stream.toChannel(newItems), Channel.pipeToOrFail(loop), Stream.fromChannel)
  })
}

export const getNewEvents = <T, TFractionalIndex extends string | number>(
  previousItemsAgg: Aggregate<T, TFractionalIndex>,
  newItems: ReadonlyArray<T>,
  fractionalIndexImpl: FractionalIndexImpl<TFractionalIndex>,
  areEqual: (a: T, b: T) => boolean = (a, b) => a === b,
): BuildResult<T, TFractionalIndex> => {
  const results = pipe(
    getNewEventsStream(previousItemsAgg, Stream.fromIterable(newItems), fractionalIndexImpl, areEqual),
    Stream.runCollect,
    Effect.map(Chunk.toReadonlyArray),
    Effect.runSync,
    (_) => _.slice(),
  )

  const newAgg = results.pop() as Aggregate<T, TFractionalIndex>
  const newEvents = results as ReadonlyArray<Event<T, TFractionalIndex>>

  // console.log('newAgg', newAgg, 'newEvents', newEvents)

  return { newAgg, newEvents }
}

export const aggregateMake = <T, TFractionalIndex extends string | number>(
  arr: ReadonlyArray<T>,
  fractionalIndexImpl: FractionalIndexImpl<TFractionalIndex>,
): Aggregate<T, TFractionalIndex> => {
  let lastIndex = fractionalIndexImpl.smallest
  return arr.map((item) => {
    lastIndex = fractionalIndexImpl.increment(lastIndex)
    return { value: item, index: lastIndex }
  })
}

export const aggregateMakeWithIndex = <T>(arr: ReadonlyArray<[T, number]>): Aggregate<T, IndexNumber> =>
  arr.map(([item, index]) => ({ value: item, index: indexNumber(index) }))
