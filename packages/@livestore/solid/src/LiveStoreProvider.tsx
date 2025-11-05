import {
  createSignal,
  createEffect,
  onCleanup,
  Switch,
  Match,
  type JSX,
  type ParentComponent,
} from "solid-js";
import {
  type Store,
  type CreateStoreOptions,
  type LiveStoreSchema,
  createStore,
  makeShutdownDeferred,
  StoreInterrupted,
  type ShutdownDeferred,
  type LiveStoreContext as StoreContext_,
  type IntentionalShutdownCause,
  type BootStatus,
} from "@livestore/livestore";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Logger,
  LogLevel,
  Scope,
} from "@livestore/utils/effect";
import { provideOtel } from "@livestore/common";
import { LiveStoreContext } from "./LiveStoreContext.ts";

type LiveStoreProviderProps = {
  schema: LiveStoreSchema;
  adapter: CreateStoreOptions<any>["adapter"];
  storeId?: string;
  loadingState?: (status: BootStatus) => JSX.Element;
  errorState?: (error: unknown) => JSX.Element;
  shutdownState?: (
    cause: IntentionalShutdownCause | StoreInterrupted,
  ) => JSX.Element;
};

export const LiveStoreProvider: ParentComponent<LiveStoreProviderProps> = (
  props,
) => {
  const [contextValue, setContextValue] = createSignal<
    StoreContext_ | BootStatus
  >({
    stage: "loading",
  });

  const lifecycle = {
    shutdownDeferred: undefined as ShutdownDeferred | undefined,
    componentScope: undefined as Scope.CloseableScope | undefined,
    cancelEffect: () => {},
  };

  createEffect(() => {
    const previousShutdownDeferred = lifecycle.shutdownDeferred;

    const interrupt = (
      scope: Scope.CloseableScope,
      deferred: ShutdownDeferred,
      reason: StoreInterrupted,
    ) =>
      Effect.gen(function* () {
        yield* Scope.close(scope, Exit.fail(reason));
        yield* Deferred.fail(deferred, reason);
      }).pipe(Effect.runFork);

    const lifecycleEffect = Effect.gen(function* () {
      if (previousShutdownDeferred) {
        yield* Effect.logDebug(
          "A prop changed. Waiting for previous store to shut down...",
        );
        yield* Deferred.await(previousShutdownDeferred).pipe(Effect.exit);
        yield* Effect.logDebug(
          "Previous store shut down. Initializing new store.",
        );
      }

      const componentScope = yield* Scope.make();
      const shutdownDeferred = yield* makeShutdownDeferred;

      lifecycle.componentScope = componentScope;
      lifecycle.shutdownDeferred = shutdownDeferred;

      yield* Effect.gen(function* () {
        const store = yield* createStore({
          schema: props.schema,
          adapter: props.adapter,
          storeId: props.storeId ?? "default",
          onBootStatus: (status) => {
            if (
              contextValue().stage === "running" ||
              contextValue().stage === "error"
            )
              return;
            setContextValue(status);
          },
        }).pipe(
          Effect.tapErrorCause((cause) =>
            Deferred.failCause(shutdownDeferred, cause),
          ),
        );

        setContextValue({ stage: "running", store });
      }).pipe(Effect.forkIn(componentScope));

      const shutdownContext = (
        cause: IntentionalShutdownCause | StoreInterrupted,
      ) => Effect.sync(() => setContextValue({ stage: "shutdown", cause }));

      yield* Deferred.await(shutdownDeferred).pipe(
        Effect.catchTag("LiveStore.IntentionalShutdownCause", (cause) =>
          shutdownContext(cause),
        ),
        Effect.catchTag("LiveStore.StoreInterrupted", (cause) =>
          shutdownContext(cause),
        ),
        Effect.tapError((error) =>
          Effect.sync(() => setContextValue({ stage: "error", error })),
        ),
        Effect.tapDefect((defect) =>
          Effect.sync(() => setContextValue({ stage: "error", error: defect })),
        ),
        Effect.exit,
      );
    }).pipe(
      Effect.scoped,
      Effect.withSpan("@livestore/solid:LiveStoreProvider"),
      provideOtel({}),
      Effect.tapCauseLogPretty,
      Logger.withMinimumLogLevel(LogLevel.Debug),
    );

    const cancelEffect = Effect.runCallback(lifecycleEffect);
    lifecycle.cancelEffect = cancelEffect;

    onCleanup(() => {
      // Reset the UI to loading for the next run
      setContextValue({ stage: "loading" });

      if (lifecycle.componentScope && lifecycle.shutdownDeferred) {
        interrupt(
          lifecycle.componentScope,
          lifecycle.shutdownDeferred,
          new StoreInterrupted({
            reason: "component unmounted or props changed",
          }),
        );
      }

      lifecycle.cancelEffect();
    });
  });

  return (
    <Switch>
      <Match when={contextValue().stage === "loading"}>
        {props.loadingState ? (
          props.loadingState(contextValue() as BootStatus)
        ) : (
          <div>Loading Store...</div>
        )}
      </Match>

      <Match when={contextValue().stage === "error"}>
        {props.errorState ? (
          props.errorState((contextValue() as { error: unknown }).error)
        ) : (
          <div>Error initializing store. Check the console.</div>
        )}
      </Match>

      <Match when={contextValue().stage === "shutdown"}>
        {props.shutdownState ? (
          props.shutdownState(
            (
              contextValue() as {
                cause: IntentionalShutdownCause | StoreInterrupted;
              }
            ).cause,
          )
        ) : (
          <div>Store has been shut down.</div>
        )}
      </Match>

      <Match when={contextValue().stage === "running"}>
        <LiveStoreContext.Provider value={contextValue()}>
          {props.children}
        </LiveStoreContext.Provider>
      </Match>
    </Switch>
  );
};
