# Multi-Store Implementation Plan

## Overview

This document outlines the implementation plan for adding multi-store support to LiveStore React integration. The implementation will be done in phases to ensure stability and allow for iterative refinement.

## Phase 1: Core Infrastructure

### 1.1 Create `createStoreContext` Function

**Location**: `packages/@livestore/react/src/createStoreContext.ts`

**Tasks**:
- [ ] Create type definitions for the tuple return type
- [ ] Implement Provider component factory
- [ ] Implement custom hook factory
- [ ] Add multi-instance registry support
- [ ] Export public API

**Key Implementation Details**:
```tsx
export function createStoreContext<TSchema extends LiveStoreSchema>(config: {
  name: string
  schema: TSchema
  adapter?: Adapter
}): [
  React.FC<StoreProviderProps<TSchema>>,
  (options?: UseStoreOptions) => Store<TSchema> & ReactAPI
]
```

### 1.2 Store State Management

**Location**: `packages/@livestore/react/src/StoreState.ts`

**Tasks**:
- [ ] Define `StoreState` type with stages (loading, running, error, shutdown)
- [ ] Create state transition logic
- [ ] Add promise management for Suspense
- [ ] Implement error handling for Error Boundaries

**States to Support**:
- `loading`: Store is being created
- `running`: Store is ready for use
- `error`: Store failed to initialize
- `shutdown`: Store has been shut down

### 1.3 Enhanced Store with React Methods

**Location**: `packages/@livestore/react/src/enhanceStore.ts`

**Tasks**:
- [ ] Create `enhanceStore` function
- [ ] Add `useQuery` method to store instance
- [ ] Add `useClientDocument` method to store instance
- [ ] Ensure proper TypeScript typing

## Phase 2: Custom Provider Component

### 2.1 Provider Component Implementation

**Location**: `packages/@livestore/react/src/components/StoreProvider.tsx`

**Tasks**:
- [ ] Create custom Provider component (not Context.Provider)
- [ ] Implement immediate child rendering
- [ ] Add store initialization on mount
- [ ] Implement lifecycle management
- [ ] Remove all render props (renderLoading, renderError, etc.)

**Key Behaviors**:
- Provider suspends until the LiveStore instance reaches the `running` stage
- No render props - all loading/error handling via Suspense/Error Boundaries
- Updates internal contexts when ready

### 2.2 Context Management

**Tasks**:
- [ ] Create default context for nearest store access
- [ ] Create registry context for multi-instance support
- [ ] Implement context provider composition
- [ ] Handle context cleanup on unmount

## Phase 3: Custom Hook Implementation

### 3.1 Primary Hook Creation

**Location**: `packages/@livestore/react/src/hooks/useStore.ts`

**Tasks**:
- [ ] Create hook factory in `createStoreContext`
- [ ] Implement default store access (no options)
- [ ] Implement multi-instance access (with storeId option)
- [ ] Add TypeScript overloads for different usage patterns

**Hook Behavior**:
```tsx
// No options: return nearest store
const store = useStore()

// With storeId: return specific instance or throw if missing
const store = useStore({ storeId: 'specific-id' })
```

### 3.2 Suspense Integration

**Tasks**:
- [ ] Make provider throw a promise until the store is ready (Suspense boundary handles fallback)
- [ ] Ensure promise resolution on successful boot and rejection on fatal errors
- [ ] Reset suspense handles when storeId changes or provider remounts

### 3.3 Error Handling

**Tasks**:
- [ ] Throw errors for Error Boundary catching
- [ ] Provide meaningful error messages
- [ ] Handle missing store instances gracefully
- [ ] Add development mode warnings

## Phase 4: Multi-Instance Support

### 4.1 Store Registry

**Location**: `packages/@livestore/react/src/StoreRegistry.ts`

**Tasks**:
- [ ] Create registry map for tracking instances
- [ ] Implement store registration on mount
- [ ] Implement store cleanup on unmount
- [ ] Add instance lookup by storeId

### 4.2 Instance Access Patterns

**Tasks**:
- [ ] Implement storeId-based lookup in hooks
- [ ] Handle concurrent access to multiple instances
- [ ] Ensure proper TypeScript inference
- [ ] Add runtime validation

## Phase 5: Migration Support

### 5.1 Documentation

**Location**: `docs/src/content/docs/reference/multi-store/migration.md`

**Tasks**:
- [ ] Write migration guide from current API
- [ ] Document breaking changes
- [ ] Provide code transformation examples
- [ ] Add troubleshooting section

### 5.2 Compatibility Considerations

**Tasks**:
- [ ] Ensure existing `LiveStoreProvider` continues to work
- [ ] Document deprecation path (if any)
- [ ] Provide codemods for common transformations (optional)

## Phase 6: Testing

### 6.1 Unit Tests

**Location**: `packages/@livestore/react/src/__tests__/`

**Test Coverage**:
- [ ] `createStoreContext` function
- [ ] Provider component rendering
- [ ] Hook behavior (default and multi-instance)
- [ ] Suspense integration
- [ ] Error boundary integration
- [ ] Multi-instance scenarios
- [ ] Store lifecycle

### 6.2 Integration Tests

**Tasks**:
- [ ] Test concurrent store loading
- [ ] Test dependent stores
- [ ] Test error scenarios
- [ ] Test with React 18/19 features
- [ ] Test TypeScript inference

### 6.3 Example Applications

**Location**: `examples/`

**Tasks**:
- [ ] Create multi-store example app
- [ ] Add comparison view example
- [ ] Add hierarchical stores example
- [ ] Update existing examples (optional)

## Phase 7: Documentation

### 7.1 API Documentation

**Location**: `docs/src/content/docs/reference/multi-store/`

**Tasks**:
- [ ] Document `createStoreContext` API
- [ ] Document Provider props
- [ ] Document hook usage patterns
- [ ] Add TypeScript examples

### 7.2 Usage Guides

**Tasks**:
- [ ] Write "Getting Started with Multi-Store" guide
- [ ] Create common patterns documentation
- [ ] Add troubleshooting guide
- [ ] Document best practices

## Implementation Order

1. **Week 1**: Core Infrastructure (Phase 1)
   - `createStoreContext` function
   - State management
   - Store enhancement

2. **Week 2**: Provider & Hook (Phase 2 & 3)
   - Custom Provider implementation
   - Custom hook with Suspense
   - Error handling

3. **Week 3**: Multi-Instance & Testing (Phase 4 & 6)
   - Registry implementation
   - Comprehensive testing
   - Bug fixes

4. **Week 4**: Documentation & Polish (Phase 7)
   - Documentation
   - Examples
   - Migration guide

## Technical Considerations

### React.use() Limitations

- `React.use()` can accept Context OR Promise, not both
- We need custom hooks that use `React.use(Promise)` internally
- Provider must be custom component, not raw Context.Provider

### Performance

- Ensure concurrent loading doesn't cause race conditions
- Optimize re-renders when stores update independently
- Monitor memory usage with multiple stores
- Cache promises for Suspense

### Type Safety

- Maintain full type inference from schema to usage
- Ensure generic types work correctly
- Test with strict TypeScript settings
- Provide good error messages for type mismatches

### Browser Compatibility

- Test in major browsers
- Ensure Web Worker integration works
- Verify SharedWorker support
- Test with different React versions

## Success Metrics

### Functional Requirements
- [ ] Multiple stores can load concurrently
- [ ] Dependent stores work correctly
- [ ] Multi-instance access works
- [ ] Type safety is maintained
- [ ] Suspense integration works
- [ ] Error boundaries catch store errors

### Performance Requirements
- [ ] No regression in single-store performance
- [ ] Concurrent loading improves total load time
- [ ] Memory usage scales linearly with store count

### Developer Experience
- [ ] API is intuitive and easy to use
- [ ] Error messages are helpful
- [ ] Documentation is comprehensive
- [ ] Migration path is clear
- [ ] TypeScript inference works well

## Risks & Mitigations

### Risk: Breaking Changes
**Mitigation**: Keep existing API working, provide gradual migration path

### Risk: Performance Regression
**Mitigation**: Comprehensive benchmarking, optimize hot paths

### Risk: Complex Error States
**Mitigation**: Clear error boundaries, helpful error messages

### Risk: Type Safety Issues
**Mitigation**: Extensive TypeScript testing, strict mode

### Risk: React Version Compatibility
**Mitigation**: Test with React 18 and 19, provide fallbacks if needed

## Open Questions

1. Should we provide a helper for composing multiple providers?
2. How should we handle store shutdown in multi-store scenarios?
3. Should we add telemetry for multi-store usage patterns?
4. Do we need a debug mode for tracking store instances?
5. Should the hook throw or return null for missing instances?

## Next Steps

1. Review and approve design documents
2. Set up development branch
3. Begin Phase 1 implementation
4. Create tracking issue for progress
5. Schedule regular review meetings
