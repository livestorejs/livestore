---
title: OpenTelemetry
sidebar:
  order: 21
---

LiveStore has built-in support for OpenTelemetry.

## Usage with React

```tsx
// otel.ts
const makeTracer = () => {
  const url = import.meta.env.VITE_OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
  const provider = new WebTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(new OTLPTraceExporter({ url }))],
  })

  provider.register()

  return provider.getTracer('livestore')
}

export const tracer = makeTracer()

// In your main entry file
import { tracer } from './otel.js'

export const App: React.FC = () => (
  <LiveStoreProvider
    // ...
    otelOptions={{ tracer }}
  >
    <AppBody />
  </LiveStoreProvider>
)

// And in your `livestore.worker.ts`
import { tracer } from './otel.js'

makeWorker({ schema, otelOptions: { tracer } })
```
