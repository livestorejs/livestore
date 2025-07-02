# End-to-End Testing Plan for LiveStore Framework Integrations

## Overview

This document outlines the comprehensive testing strategy for LiveStore's framework integrations (React, Solid, and future Vue support) in response to [Issue #313](https://github.com/livestorejs/livestore/issues/313). The goal is to ensure reliability and consistency across all supported frameworks while catching integration-specific issues early.

## Current State Analysis

### Existing Framework Integrations

1. **React** (`@livestore/react`)
   - Most mature integration with existing test suite
   - Uses React Testing Library with Vitest
   - Provides hooks: `useQuery`, `useQueryRef`, `useClientDocument`, `useStore`
   - Has Provider pattern with `LiveStoreProvider`

2. **Solid** (`@livestore/solid`)
   - Simpler API surface with `getStore()` and `query()`
   - No existing tests (package.json shows "test": "echo 'todo'")
   - Uses Solid's signal-based reactivity

3. **GraphQL** (`@livestore/graphql`)
   - Provides GraphQL integration layer
   - No tests yet

4. **Vue** (planned)
   - Not yet implemented
   - Will follow similar patterns to React/Solid

### Testing Infrastructure

- **Test Runner**: Vitest with TypeScript support
- **E2E Testing**: Playwright configured but not utilized for framework tests
- **Existing Tests**: Mainly unit tests for core packages and React integration
- **Performance Tests**: Basic performance benchmarks in `/tests/perf/`

## Proposed Testing Architecture

### 1. Unified Test Suite Approach (80% of tests)

Based on our analysis, approximately 80% of integration tests can be unified across frameworks using a protocol-driven approach. This ensures consistent behavior while reducing duplication.

#### Framework Adapter Pattern

```typescript
interface FrameworkAdapter<T> {
  name: string;
  
  // Environment setup
  createTestEnvironment(): Promise<TestEnvironment<T>>;
  cleanup(env: TestEnvironment<T>): Promise<void>;
  
  // Core operations
  renderQuery(query: LiveQueryDef, env: TestEnvironment<T>): QueryResult<T>;
  updateStore(env: TestEnvironment<T>, updates: StoreUpdate[]): Promise<void>;
  
  // Lifecycle operations
  reloadApp(env: TestEnvironment<T>): Promise<void>;
  shutdownStore(env: TestEnvironment<T>): Promise<void>;
  
  // Assertions
  assertRenderCount(env: TestEnvironment<T>, expected: number): void;
  assertQueryResult(result: QueryResult<T>, expected: any): void;
}
```

#### Test Protocols

Test protocols define framework-agnostic test scenarios that all integrations must pass:

1. **Query Subscription Protocol**
   - Subscribe to single query
   - Subscribe to multiple queries
   - Unsubscribe and cleanup
   - Handle query errors
   - Test query caching behavior

2. **Reactivity Protocol**
   - Update data and verify re-renders
   - Test batched updates
   - Verify minimal re-renders
   - Test computed/derived queries

3. **Multi-Instance Protocol**
   - Run multiple LiveStore instances
   - Test isolation between instances
   - Verify no cross-contamination

4. **Lifecycle Protocol**
   - App initialization
   - Hot reload scenarios
   - Store shutdown and cleanup
   - Error recovery

5. **Performance Protocol**
   - Measure query latency
   - Track memory usage
   - Monitor re-render counts
   - Benchmark large datasets

### 2. Framework-Specific Tests (20% of tests)

Each framework has unique characteristics that require dedicated tests:

#### React-Specific Tests
- StrictMode compatibility
- Provider nesting and context isolation
- Hook rules compliance (Rules of Hooks)
- Concurrent features compatibility
- Suspense integration (if applicable)

#### Solid-Specific Tests
- Signal timing and batching
- Accessor pattern behavior
- Fine-grained reactivity
- Resource management

#### Vue-Specific Tests (future)
- Composition API integration
- Options API compatibility (if supported)
- Ref/Reactive behavior
- Component lifecycle integration

### 3. End-to-End Test Applications

Create minimal but realistic test applications for each framework:

```
tests/e2e/apps/
├── shared/
│   ├── schemas.ts          # Shared LiveStore schemas
│   ├── fixtures.ts         # Test data fixtures
│   └── scenarios.ts        # Common test scenarios
├── react-app/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── TodoList.tsx
│   │   └── MultiStore.tsx
│   └── package.json
├── solid-app/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── TodoList.tsx
│   │   └── MultiStore.tsx
│   └── package.json
└── vue-app/              # Future
```

### 4. Playwright Configuration

Map each framework to specific ports for parallel testing:

```typescript
// playwright.config.ts
export default defineConfig({
  projects: [
    {
      name: 'react',
      use: {
        baseURL: 'http://localhost:3001',
      },
    },
    {
      name: 'solid',
      use: {
        baseURL: 'http://localhost:3002',
      },
    },
    {
      name: 'vue',
      use: {
        baseURL: 'http://localhost:3003',
      },
    },
  ],
});
```

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
1. Set up test infrastructure and framework adapter interface
2. Create shared test utilities and fixtures
3. Implement React adapter (building on existing tests)
4. Create first test protocol (Query Subscription)
5. Set up CI/CD integration

### Phase 2: Core Protocols (Week 3-4)
1. Implement Solid adapter
2. Add Reactivity and Lifecycle protocols
3. Create test applications for React and Solid
4. Configure Playwright for E2E tests
5. Add performance benchmarking

### Phase 3: Advanced Testing (Week 5-6)
1. Implement Multi-Instance protocol
2. Add framework-specific test suites
3. Create comprehensive error handling tests
4. Add memory leak detection
5. Document testing best practices

### Phase 4: Vue Integration (Future)
1. Create Vue adapter when package is ready
2. Ensure all protocols pass for Vue
3. Add Vue-specific tests
4. Update documentation

## Directory Structure

```
tests/
├── e2e/
│   ├── framework-adapters/
│   │   ├── react.adapter.ts
│   │   ├── solid.adapter.ts
│   │   ├── vue.adapter.ts         # future
│   │   ├── types.ts
│   │   └── base.adapter.ts
│   ├── protocols/
│   │   ├── query-subscription.protocol.ts
│   │   ├── reactivity.protocol.ts
│   │   ├── multi-instance.protocol.ts
│   │   ├── lifecycle.protocol.ts
│   │   ├── performance.protocol.ts
│   │   └── index.ts
│   ├── apps/
│   │   ├── shared/
│   │   ├── react-app/
│   │   ├── solid-app/
│   │   └── vue-app/              # future
│   ├── utils/
│   │   ├── test-store.ts
│   │   ├── fixtures.ts
│   │   └── assertions.ts
│   └── playwright.config.ts
├── framework-specific/
│   ├── react/
│   │   └── strict-mode.test.ts
│   ├── solid/
│   │   └── signal-timing.test.ts
│   └── vue/                      # future
└── integration/
    └── run-all-protocols.ts      # Orchestration script
```

## Success Criteria

1. **Coverage**: All framework integrations have >90% test coverage
2. **Consistency**: All frameworks pass the same protocol tests
3. **Performance**: No performance regressions detected
4. **Reliability**: Tests are stable and not flaky
5. **Maintainability**: Adding new frameworks or tests is straightforward
6. **Documentation**: Clear guidelines for contributors

## Example Test Implementation

Here's how a unified test would look:

```typescript
// tests/e2e/protocols/query-subscription.protocol.ts
export function querySubscriptionProtocol<T>(adapter: FrameworkAdapter<T>) {
  describe(`${adapter.name}: Query Subscription Protocol`, () => {
    let env: TestEnvironment<T>;

    beforeEach(async () => {
      env = await adapter.createTestEnvironment();
    });

    afterEach(async () => {
      await adapter.cleanup(env);
    });

    test('subscribes to query and receives initial data', async () => {
      const query = todoListQuery();
      const result = adapter.renderQuery(query, env);
      
      adapter.assertQueryResult(result, {
        todos: [
          { id: '1', title: 'Test Todo', completed: false }
        ]
      });
    });

    test('updates when underlying data changes', async () => {
      const query = todoListQuery();
      const result = adapter.renderQuery(query, env);
      
      await adapter.updateStore(env, [
        { type: 'INSERT', table: 'todos', data: { id: '2', title: 'New Todo' } }
      ]);
      
      adapter.assertQueryResult(result, {
        todos: [
          { id: '1', title: 'Test Todo', completed: false },
          { id: '2', title: 'New Todo', completed: false }
        ]
      });
      
      adapter.assertRenderCount(env, 2); // Initial + Update
    });
  });
}
```

## Benefits of This Approach

1. **Consistency**: Ensures all frameworks behave identically for core functionality
2. **Efficiency**: Write tests once, run for all frameworks
3. **Maintainability**: Changes to test scenarios automatically apply to all frameworks
4. **Flexibility**: Framework-specific tests handle unique requirements
5. **Scalability**: Easy to add new frameworks (Vue, Angular, etc.)
6. **Confidence**: Comprehensive coverage catches issues early

## Next Steps

1. Review and approve this testing plan
2. Create initial PR with basic infrastructure
3. Implement React adapter as reference implementation
4. Begin implementing test protocols
5. Onboard contributors to help with implementation

## Open Questions

1. Should we test against multiple versions of each framework (e.g., React 17 vs 18)?
2. How should we handle testing of server-side rendering (SSR) scenarios?
3. What performance benchmarks should we establish as baselines?
4. Should we include bundle size testing as part of the framework tests?

## Conclusion

This testing strategy balances the need for comprehensive coverage with maintainability. By unifying 80% of tests through protocols while allowing framework-specific tests for unique behaviors, we ensure LiveStore works consistently across all supported frameworks while respecting their individual characteristics.