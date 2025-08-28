# Multi-Store Design Requirements

## Overview

This document outlines the requirements for supporting multiple LiveStore instances in React applications, particularly for scenarios like Linear where you might have a workspace store, project stores, and issue stores.

## Hard Requirements

### 1. Clean API Design
- **Preferred API**: `store.useQuery()` over `useQuery({ store })`
- Store instance methods provide a cleaner, more intuitive API

### 2. Multiple Store Instances
- Must support multiple instances of the same store type in one component
- Example: Viewing multiple issues simultaneously (issue-123 and issue-456)
- Example: Comparing data across different project stores

### 3. Application-Controlled Dependencies
- Store dependencies handled in application code, not the library
- No first-class dependency API (`dependsOn`, `deriveFrom`)
- Users control when/how stores are created based on other stores
- Natural React component composition for dependency management

### 4. Type Safety
- Full TypeScript inference from schema to usage
- Store definitions carry schema types through to hooks
- No loss of type information at any level

### 5. Dynamic Store IDs
- Store IDs are often runtime values:
  - Project ID from route parameters
  - User ID from authentication
  - IDs derived from other store data
- Cannot rely on compile-time store IDs

### 6. React Best Practices
- Follow React patterns and conventions
- No `onReady` callbacks - use child components for dependent logic
- Respect component lifecycle and hooks rules
- Embrace Context/Provider terminology

### 7. Concurrent Store Loading
- Independent stores must load concurrently for performance
- Providers render children immediately (don't block on loading)
- Use React Suspense for handling loading states

## Design Preferences

### Simplicity
- Keep the library simple - provide primitives, not frameworks
- Explicit over implicit
- Clear separation between single and multi-store APIs

### Naming Conventions
- Use `StoreContext` suffix (e.g., `WorkspaceStoreContext`)
- Variable naming: `const workspaceStore = React.use(WorkspaceStoreContext)`

### Common Case Optimization
- Optimize for single instance per store type (common case)
- Multi-instance support available but not the primary API

### Modern React Patterns
- Use `React.use()` as primary API (currently equivalent to `useContext`)
- Suspense for loading states
- Error boundaries for error handling

## Use Cases to Support

### 1. Independent Stores
Multiple stores with no relationships that should load concurrently:
- User settings store
- Notifications store  
- Workspace store

### 2. Hierarchical Stores
Stores with parent-child relationships:
- Workspace → Project → Issue
- User controls loading order via component nesting

### 3. Multiple Instances
Same store type with different data:
- Multiple issue stores in a comparison view
- Different project stores in tabs
- Historical snapshots of the same store

### 4. Dynamic Store Creation
Stores created based on runtime conditions:
- Route parameters determine store IDs
- User selections create new stores
- API responses trigger store creation

## Non-Requirements

### What We're NOT Building
- Automatic dependency resolution between stores
- Store lifecycle management at the framework level
- Default store concepts or implicit store selection
- Complex state synchronization between stores

## Success Criteria

A successful multi-store implementation will:
1. Allow concurrent loading of independent stores
2. Support accessing multiple instances of the same store type
3. Maintain full type safety
4. Feel natural to React developers
5. Not break existing single-store applications
6. Handle loading and error states elegantly via Suspense and Error Boundaries