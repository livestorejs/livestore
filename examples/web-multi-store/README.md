# Multi-Store App

This example demonstrates the Multi-Store API for managing multiple LiveStore stores in a React application.

## Key Implementation Details

- **Store Options**: Each store type (workspace, issue) is defined through re-usable store options.
- **Suspense Integration**: Each provider suspends until the store is ready, using React Suspense boundaries
- **Error Boundaries**: Errors during store initialization are caught by React Error Boundaries
- **Multi-Instance Access**: Components can access specific store instances using `useStore({ storeId: 'instance-id', ... })`
