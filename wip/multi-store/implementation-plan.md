# Multi-Store Implementation Plan

## Overview

This document outlines the implementation plan for adding multi-store support to LiveStore React integration. The implementation will be done in phases to ensure stability and allow for iterative refinement.

## Phase 1: Core Infrastructure

### 1.1 Create `defineStoreContext` Function

**Location**: `packages/@livestore/react/src/defineStoreContext.ts`

**Tasks**:
- [ ] Create type definitions for `StoreContextDefinition`
- [ ] Implement context creation logic
- [ ] Add registry context for multi-instance support
- [ ] Export public API

**Key Implementation Details**:
```tsx
export function defineStoreContext<TSchema extends LiveStoreSchema>(config: {
  name: string
  schema: TSchema
  adapter?: Adapter
}): StoreContextDefinition<TSchema>
```

### 1.2 Store State Management

**Location**: `packages/@livestore/react/src/StoreState.ts`

**Tasks**:
- [ ] Define `StoreState` type with stages (loading, running, error, shutdown)
- [ ] Create state transition logic
- [ ] Add promise management for Suspense
- [ ] Implement error handling

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

## Phase 2: Provider Implementation

### 2.1 Store Provider Component

**Location**: `packages/@livestore/react/src/StoreProvider.tsx`

**Tasks**:
- [ ] Implement Provider component that renders children immediately
- [ ] Add store creation logic using existing `useCreateStore`
- [ ] Implement registry registration for multi-instance
- [ ] Add lifecycle management (cleanup on unmount)

**Key Behaviors**:
- Children render immediately (don't wait for store)
- Store loads in background
- Updates context when ready

### 2.2 Suspense Integration

**Tasks**:
- [ ] Create promise for store loading
- [ ] Implement promise throwing for `React.use`
- [ ] Add Suspense detection logic
- [ ] Test with React Suspense boundaries

### 2.3 Error Boundary Integration

**Tasks**:
- [ ] Implement error propagation
- [ ] Ensure errors are catchable by Error Boundaries
- [ ] Add proper error messages and debugging info

## Phase 3: Multi-Instance Support

### 3.1 Store Registry

**Location**: `packages/@livestore/react/src/StoreRegistry.ts`

**Tasks**:
- [ ] Create registry context for tracking multiple instances
- [ ] Implement `withStoreId` function
- [ ] Add instance lookup logic
- [ ] Handle missing instances gracefully

### 3.2 Instance Management

**Tasks**:
- [ ] Track stores by storeId in registry
- [ ] Implement cleanup on unmount
- [ ] Handle storeId changes
- [ ] Prevent memory leaks

## Phase 4: Migration Support

### 4.1 Backwards Compatibility

**Tasks**:
- [ ] Keep existing `LiveStoreProvider` working
- [ ] Keep existing `useStore` hook working
- [ ] Keep existing `useQuery` hook working
- [ ] Add deprecation notices (if needed)

### 4.2 Migration Guide

**Location**: `docs/src/content/docs/reference/multi-store/migration.md`

**Tasks**:
- [ ] Write migration examples
- [ ] Document breaking changes (if any)
- [ ] Provide code transformation examples
- [ ] Add troubleshooting section

## Phase 5: Testing

### 5.1 Unit Tests

**Location**: `packages/@livestore/react/src/__tests__/`

**Test Coverage**:
- [ ] `defineStoreContext` function
- [ ] Provider component rendering
- [ ] Suspense integration
- [ ] Error handling
- [ ] Multi-instance access
- [ ] Store lifecycle

### 5.2 Integration Tests

**Tasks**:
- [ ] Test concurrent store loading
- [ ] Test dependent stores
- [ ] Test multi-instance scenarios
- [ ] Test error scenarios
- [ ] Test with React 18/19 features

### 5.3 Example Applications

**Location**: `examples/`

**Tasks**:
- [ ] Create multi-store example app
- [ ] Update existing examples (optional)
- [ ] Add comparison view example
- [ ] Add hierarchical stores example

## Phase 6: Documentation

### 6.1 API Documentation

**Location**: `docs/src/content/docs/reference/multi-store/`

**Tasks**:
- [ ] Document `defineStoreContext` API
- [ ] Document Provider props
- [ ] Document `withStoreId` usage
- [ ] Add TypeScript examples

### 6.2 Usage Guides

**Tasks**:
- [ ] Write "Getting Started with Multi-Store" guide
- [ ] Create common patterns documentation
- [ ] Add troubleshooting guide
- [ ] Document best practices

### 6.3 Code Examples

**Tasks**:
- [ ] Simple multi-store setup
- [ ] Dependent stores example
- [ ] Concurrent loading example
- [ ] Multi-instance example

## Implementation Order

1. **Week 1**: Core Infrastructure (Phase 1)
   - `defineStoreContext` function
   - State management
   - Store enhancement

2. **Week 2**: Provider & Suspense (Phase 2)
   - Provider implementation
   - Suspense integration
   - Error handling

3. **Week 3**: Multi-Instance & Testing (Phase 3 & 5)
   - Registry implementation
   - Comprehensive testing
   - Bug fixes

4. **Week 4**: Documentation & Polish (Phase 6)
   - Documentation
   - Examples
   - Migration guide

## Technical Considerations

### Performance
- Ensure concurrent loading doesn't cause race conditions
- Optimize re-renders when stores update
- Monitor memory usage with multiple stores

### Type Safety
- Maintain full type inference from schema to usage
- Ensure generic types work correctly
- Test with strict TypeScript settings

### React Compatibility
- Test with React 18 and 19
- Ensure Suspense works correctly
- Verify Error Boundary integration

### Browser Compatibility
- Test in major browsers
- Ensure Web Worker integration works
- Verify SharedWorker support

## Success Metrics

### Functional Requirements
- [ ] Multiple stores can load concurrently
- [ ] Dependent stores work correctly
- [ ] Multi-instance access works
- [ ] Type safety is maintained
- [ ] Existing code continues to work

### Performance Requirements
- [ ] No regression in single-store performance
- [ ] Concurrent loading improves total load time
- [ ] Memory usage scales linearly with store count

### Developer Experience
- [ ] API is intuitive and easy to use
- [ ] Error messages are helpful
- [ ] Documentation is comprehensive
- [ ] Migration path is clear

## Risks & Mitigations

### Risk: Breaking Changes
**Mitigation**: Keep existing API working, provide gradual migration path

### Risk: Performance Regression
**Mitigation**: Comprehensive benchmarking, optimize hot paths

### Risk: Complex Error States
**Mitigation**: Clear error boundaries, helpful error messages

### Risk: Type Safety Issues
**Mitigation**: Extensive TypeScript testing, strict mode

## Open Questions

1. Should we provide a helper for composing multiple providers?
2. How should we handle store shutdown in multi-store scenarios?
3. Should we add telemetry for multi-store usage patterns?
4. Do we need a debug mode for tracking store instances?

## Next Steps

1. Review and approve design documents
2. Set up development branch
3. Begin Phase 1 implementation
4. Create tracking issue for progress
5. Schedule regular review meetings