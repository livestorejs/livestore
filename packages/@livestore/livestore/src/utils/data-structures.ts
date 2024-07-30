// TODO consider replacing with Effect's RC data structures
export class ReferenceCountedSet<T> {
  private map: Map<T, number>

  constructor() {
    this.map = new Map<T, number>()
  }

  add = (key: T) => {
    const count = this.map.get(key) ?? 0
    this.map.set(key, count + 1)
  }

  remove = (key: T) => {
    const count = this.map.get(key) ?? 0
    if (count === 1) {
      this.map.delete(key)
    } else {
      this.map.set(key, count - 1)
    }
  }

  has = (key: T) => {
    return this.map.has(key)
  }

  get size() {
    return this.map.size
  }

  *[Symbol.iterator]() {
    for (const key of this.map.keys()) {
      yield key
    }
  }
}
