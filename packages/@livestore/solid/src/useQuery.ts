import {
  createStore,
  reconcile,
  type Store as SolidStore,
} from "solid-js/store";
import type { LiveQueries } from "@livestore/livestore/internal";
import * as Solid from "solid-js";
import { useLiveStore } from "./LiveStoreContext.ts";
import { type LiveQuery, type Store } from "@livestore/livestore";

type LiveQueryOptions = {
  store?: Store;
  primaryKey?: string;
};

const activeQueries = new Map<
  string,
  { store: SolidStore<any>; count: number; unsubscribe: () => void }
>();

/**
 * A SolidJS hook for subscribing to a LiveQuery and receiving its results
 * as a reactive Solid store.
 *
 * @param queryDef The LiveQuery definition object that specifies the data to fetch.
 * @param [options={}] Optional configuration for the hook.
 * @param [options.store] An explicit `livestore` instance to use. If not provided,
 *   the hook will search for one in the SolidJS context.
 * @param [options.primaryKey="id"] The name of the key that is unique across returned rows
 *  (i.e. the primary key of the queried table), defaults to "id"
 */
export function useQuery<TQuery extends LiveQueries.LiveQueryDef.Any>(
  queryDef: TQuery,
  options: LiveQueryOptions = {}, // Default to empty options
): SolidStore<LiveQueries.GetResult<TQuery>> {
  const livestore = options.store ?? useLiveStore();
  const key = options.primaryKey ?? "id";

  if (!livestore) {
    throw new Error(
      "useLiveQuery: No store was provided via options, and no store was found in context. " +
        "Make sure this hook is used inside a <LiveStoreProvider>.",
    );
  }

  const queryKey = `${livestore.storeId}_${livestore.clientId}_${livestore.sessionId}_${queryDef.hash}`;

  const existing = activeQueries.get(queryKey);
  if (existing) {
    existing.count++;
    Solid.onCleanup(() => {
      existing.count--;
      if (existing.count === 0) {
        existing.unsubscribe();
        activeQueries.delete(queryKey);
      }
    });
    return existing.store;
  }

  const query = queryDef.make(livestore.reactivityGraph.context!);
  const query$ = query.value as LiveQuery<LiveQueries.GetResult<TQuery>>;
  const getInitialResult = () => {
    try {
      return query$.run({});
    } catch (cause: any) {
      console.error("[@livestore/react:useQuery] Error running query", cause);
      throw new Error(
        `\
  [@livestore/solid:useLiveQuery] Error running query: ${cause.name}

  Query: ${query$.label}

  Stack trace:
  `,
        { cause },
      );
    }
  };

  const [solidStore, setSolidStore] = createStore(getInitialResult());

  const unsubscribe = livestore.subscribe(queryDef, {
    onUpdate: (newResult: LiveQueries.GetResult<TQuery>) => {
      if (newResult) {
        setSolidStore(reconcile(newResult, { merge: true, key }));
      }
    },
  });

  const newQuery = { store: solidStore, count: 1, unsubscribe };
  activeQueries.set(queryKey, newQuery);

  Solid.onCleanup(() => {
    newQuery.count--;
    if (newQuery.count === 0) {
      newQuery.unsubscribe();
      activeQueries.delete(queryKey);
    }
  });

  return solidStore;
}
