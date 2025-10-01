declare module 'vue-livestore' {
  export const LiveStoreProvider: any
  export const useStore: () => { store: any }
  export const useQuery: (query: unknown) => any
  export const useClientDocument: (doc: unknown) => Record<string, any>
}
