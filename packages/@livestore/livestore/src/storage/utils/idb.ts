/* eslint-disable unicorn/prefer-add-event-listener */
/* eslint-disable prefer-arrow/prefer-arrow-functions */

export class IDB {
  private db: IDBDatabase | null = null

  constructor(
    private dbName: string,
    private storeName: string = 'binary_store',
  ) {}

  private async open(): Promise<IDBDatabase> {
    if (this.db) return this.db

    return new Promise((resolve, reject) => {
      const openRequest = indexedDB.open(this.dbName, 1)

      openRequest.onupgradeneeded = () => {
        const db = openRequest.result
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName)
        }
      }

      openRequest.onsuccess = () => {
        this.db = openRequest.result
        resolve(this.db)
      }

      openRequest.onerror = () => {
        reject(new Error('Failed to open database.'))
      }
    })
  }

  public async get(key: string): Promise<Uint8Array | undefined> {
    const db = await this.open()

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly')
      const store = transaction.objectStore(this.storeName)
      const getRequest = store.get(key)

      getRequest.onsuccess = () => {
        resolve(getRequest.result)
      }

      getRequest.onerror = () => {
        reject(new Error('Failed to get data.'))
      }
    })
  }

  public async put(key: string, value: Uint8Array): Promise<void> {
    const db = await this.open()

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite')
      const store = transaction.objectStore(this.storeName)
      const putRequest = store.put(value, key)

      putRequest.onsuccess = () => {
        resolve()
      }

      putRequest.onerror = () => {
        reject(new Error('Failed to write data.'))
      }
    })
  }

  public async deleteDb(): Promise<void> {
    return new Promise((resolve, reject) => {
      const deleteRequest = indexedDB.deleteDatabase(this.dbName)

      deleteRequest.onsuccess = () => {
        resolve()
      }

      deleteRequest.onerror = () => {
        reject(new Error('Failed to delete database.'))
      }
    })
  }
}
