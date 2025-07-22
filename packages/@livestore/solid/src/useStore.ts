import type { LiveStoreSchema, Store } from "@livestore/livestore";
import { useLiveStore } from "./LiveStoreContext.ts";

/**
 * A SolidJS function for accessing a Livestore instance.
 *
 * @param [options={}] Optional configuration for the hook.
 * @param [options.store] An explicit `livestore` instance to use. If not provided,
 *   the hook will search for one in the SolidJS context.
 **/
export function useStore(
  options: { store?: Store } = {},
): Store<LiveStoreSchema> {
  const livestore = options.store ?? useLiveStore();

  if (!livestore) {
    throw new Error(
      "useLiveQuery: No store was provided via options, and no store was found in context. " +
        "Make sure this hook is used inside a <LiveStoreProvider>.",
    );
  } else {
    return livestore;
  }
}
