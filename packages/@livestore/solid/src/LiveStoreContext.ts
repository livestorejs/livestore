import { createContext, useContext } from "solid-js";
import type { Store, LiveStoreSchema } from "@livestore/livestore";

export type LiveStoreContextValue = {
  store: Store<LiveStoreSchema>;
};

export const LiveStoreContext = createContext<LiveStoreContextValue>();

export function useLiveStore(): Store<LiveStoreSchema> {
  const context = useContext(LiveStoreContext);
  if (!context) {
    throw new Error("useLiveStore must be used within a <LiveStoreProvider>");
  }
  return context.store;
}
