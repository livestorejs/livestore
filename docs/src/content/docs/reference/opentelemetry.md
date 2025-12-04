---
title: OpenTelemetry
sidebar:
  order: 21
---

import { Tabs, TabItem } from '@astrojs/starlight/components';

import OtelSnippet from '../../_assets/code/reference/opentelemetry/otel.ts?snippet'
import AppSnippet from '../../_assets/code/reference/opentelemetry/app.tsx?snippet'
import WorkerSnippet from '../../_assets/code/reference/opentelemetry/livestore.worker.ts?snippet'

LiveStore has built-in support for OpenTelemetry.

## Usage with React

<Tabs>
  <TabItem label="otel.ts">
    <OtelSnippet />
  </TabItem>
  <TabItem label="App.tsx">
    <AppSnippet />
  </TabItem>
  <TabItem label="livestore.worker.ts">
    <WorkerSnippet />
  </TabItem>
</Tabs>
