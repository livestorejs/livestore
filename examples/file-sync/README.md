# File Sync - LiveStore Example

A bidirectional file synchronization CLI tool built with LiveStore and Effect.

> **⚠️ Work in Progress**  
> This project is currently in development. See [PLAN.md](./PLAN.md) for the complete design specification.

## Overview

This example demonstrates how to build a sophisticated file synchronization system using:

- **LiveStore** for event sourcing and state management
- **Effect** for functional programming and error handling  
- **Node.js** for file system operations and CLI interface
- **TypeScript** for type safety and developer experience

## Features (Planned)

- ✅ **Bidirectional sync**: Changes in either folder sync to the other
- ✅ **One-time or continuous**: Support both `sync` and `watch` modes
- ✅ **Conflict resolution**: Graceful handling of concurrent modifications
- ✅ **User vs app change detection**: Differentiate user changes from sync operations
- ✅ **Full audit trail**: Event sourcing provides complete change history
- ✅ **Type-safe**: Built with Effect for comprehensive error handling

## Quick Start

### Installation

```bash
# Clone the LiveStore repository
git clone https://github.com/livestore/livestore
cd livestore/examples/file-sync

# Install dependencies
pnpm install

# Build the project
pnpm build
```

### Usage

```bash
# One-time bidirectional sync
pnpm start sync /path/to/dir-a /path/to/dir-b

# Continuous watching mode (runs until interrupted)  
pnpm start watch /path/to/dir-a /path/to/dir-b

# View sync status and conflicts
pnpm start status
pnpm start conflicts list

# Resolve conflicts
pnpm start conflicts resolve <file-id> --strategy=keep-newest
```

## Development

### Build

```bash
pnpm build
```

### Run in Development Mode

```bash
pnpm dev sync /path/to/test-dir-a /path/to/test-dir-b
```

### Type Checking

```bash
pnpm typecheck
```

### Linting

```bash
pnpm lint
pnpm lint:fix
```

### Testing

```bash
pnpm test
```

## Architecture

This example showcases several advanced LiveStore and Effect patterns:

### Event Sourcing Design
- **File lifecycle events** (created, modified, deleted, moved)
- **Sync operation events** (intent, completed, failed)  
- **Conflict resolution events** (detected, resolved)

### Services Architecture
- **FileWatcherService**: Cross-platform file system monitoring
- **SyncEngineService**: Bidirectional sync orchestration
- **ConflictResolverService**: Conflict detection and resolution

### Advanced Features
- **User vs app change detection** to prevent sync loops
- **Content-based conflict detection** using file hashes
- **Multiple resolution strategies** (newest, largest, manual)
- **Comprehensive CLI** with status reporting and interactive conflict resolution

## Implementation Status

- [ ] **Phase 1**: Core Foundation (This PR)
  - [x] Project structure and configuration  
  - [x] Comprehensive design documentation
  - [x] Package setup with dependencies
  - [ ] Basic CLI scaffold

- [ ] **Phase 2**: Event Schema & State
- [ ] **Phase 3**: File System Integration  
- [ ] **Phase 4**: Sync Engine
- [ ] **Phase 5**: Conflict Resolution
- [ ] **Phase 6**: CLI Commands
- [ ] **Phase 7**: Advanced Features
- [ ] **Phase 8**: Testing & Documentation

See [PLAN.md](./PLAN.md) for detailed implementation phases and technical specifications.

## Contributing

This example is part of the LiveStore monorepo. See the main [CONTRIBUTING.md](../../CONTRIBUTING.md) for development guidelines.

## Related Examples

- [`node-effect-cli`](../node-effect-cli/) - Basic Effect CLI patterns
- [`web-todomvc`](../web-todomvc/) - LiveStore event sourcing fundamentals  
- [`expo-linearlite`](../expo-linearlite/) - Complex state management patterns

## Learn More

- [LiveStore Documentation](https://docs.livestore.dev)
- [Effect Documentation](https://effect.website)
- [File Sync Design Plan](./PLAN.md)