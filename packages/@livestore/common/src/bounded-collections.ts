/**
 * Creates a map that has a fixed number of entries.
 * Once hitting the bound, earliest insertions are removed
 */
export class BoundMap<K, V> {
  #map = new Map<K, V>()
  #sizeLimit: number

  constructor(sizeLimit: number) {
    this.#sizeLimit = sizeLimit
  }

  onEvict: ((key: K, value: V) => void) | undefined

  set = (key: K, value: V) => {
    this.#map.set(key, value)
    // console.log(this.#map.size, this.#sizeLimit);
    if (this.#map.size > this.#sizeLimit) {
      const firstKey = this.#map.keys().next().value
      const deletedValue = this.#map.get(firstKey)!
      this.#map.delete(firstKey)
      if (this.onEvict) {
        this.onEvict(firstKey, deletedValue)
      }
    }
  }

  get = (key: K): V | undefined => {
    return this.#map.get(key)
  }

  delete = (key: K) => {
    this.#map.delete(key)
  }

  keys = () => {
    return this.#map.keys()
  }
}

export class BoundSet<V> {
  #map: BoundMap<V, V>

  constructor(sizeLimit: number) {
    this.#map = new BoundMap(sizeLimit)
    this.#map.onEvict = this.#onEvict
  }

  #onEvict = (v: V) => {
    if (this.onEvict) {
      this.onEvict(v)
    }
  }

  onEvict: ((key: V) => void) | undefined

  add = (v: V) => {
    this.#map.set(v, v)
  };

  [Symbol.iterator] = () => {
    return this.#map.keys()
  }
}

export class BoundArray<V> {
  #array: V[] = []
  public sizeLimit: number

  constructor(sizeLimit: number) {
    this.sizeLimit = sizeLimit
  }

  static make = <V>(sizeLimit: number, initial: Iterable<V> = []): BoundArray<V> => {
    const b = new BoundArray<V>(sizeLimit)
    for (const v of initial) {
      b.push(v)
    }
    return b
  }

  onEvict: ((key: V) => void) | undefined

  push = (v: V) => {
    this.#array.push(v)
    if (this.#array.length > this.sizeLimit) {
      const first = this.#array.shift()
      if (first && this.onEvict) {
        this.onEvict(first)
      }
    }
  }

  get = (index: number): V | undefined => {
    return this.#array[index]
  }

  delete = (index: number) => {
    this.#array.splice(index, 1)
  }

  get length() {
    return this.#array.length
  }

  [Symbol.iterator] = (): IterableIterator<V> => {
    return this.#array[Symbol.iterator]()
  }

  map = <T>(fn: (v: V) => T): T[] => {
    return this.#array.map(fn)
  }

  clear = () => {
    this.#array = []
  }

  sort = (fn?: (a: V, b: V) => number) => {
    return this.#array.sort(fn)
  }
}
