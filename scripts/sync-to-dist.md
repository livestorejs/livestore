# LiveStore Distribution Sync CLI

A CLI tool that syncs LiveStore source packages to a clean distribution
directory that enables seamless live reloading when developing LiveStore in the
context of external projects like bug repos.

## The Problem & Solution

When developing LiveStore, we often need to test changes in external projects
(like bug reproduction repos). However, traditional approaches have limitations:

- **pnpm link doesn't work reliably** due to Node.js module resolution issues
- **We can't include external projects** like bug repros directly in the
  LiveStore monorepo (as it would pollute the monorepo with external
  dependencies / change `pnpm-lock.yaml`)
- **We still need seamless live reloading** when making changes to LiveStore for
  debugging and development

## Our Hybrid Approach

Here's how we solve this with a hybrid approach that combines the best of
symlinks and file syncing:

**The Setup:**

1. **LiveStore Monorepo** - Where we develop LiveStore packages
2. **External Projects** - Bug repos, test projects, etc. that use LiveStore
3. **LiveStore-dist Directory** - A third location that acts as an intermediary

**How It Works:**

1. **Sync Step**: We sync a replica of LiveStore packages to `livestore-dist/`,
   excluding `node_modules`
2. **Reference Step**: External projects use pnpm overrides to point to the
   `livestore-dist` directory
3. **Live Reloading**: As we make changes to LiveStore source in the monorepo,
   they're constantly synced to `livestore-dist`, giving us immediate feedback
   in external projects

This approach gives us the reliability of file-based overrides while maintaining
the convenience of live reloading during development.

> **Note**: This is a hybrid evolution of our previous `create-symlink-dist`
> approach. Instead of creating symlinks that could break with pnpm's internal
> structure, we now sync real files to a distribution directory, giving us the
> same development experience with better reliability.

## Usage

```bash
# One-time sync to default location (../livestore-dist)
bun scripts/sync-to-dist.ts

# One-time sync to custom distribution directory
bun scripts/sync-to-dist.ts --dist ../my-livestore-dist

# Sync + automatically patch target project
bun scripts/sync-to-dist.ts --patch-target ../bug-repo

# Continuous sync with file watching
bun scripts/sync-to-dist.ts --watch

# All options combined
bun scripts/sync-to-dist.ts --dist ../my-dist --patch-target ../bug-repo --watch
```

### Examples

```bash
# Sync to default location (../livestore-dist)
bun scripts/sync-to-dist.ts

# Sync to custom distribution directory
bun scripts/sync-to-dist.ts --dist ../my-livestore-dist

# Sync + patch target project (automatically adds pnpm overrides and runs pnpm install)
bun scripts/sync-to-dist.ts --patch-target ../bug-repo

# Custom dist + patch target
bun scripts/sync-to-dist.ts --dist ../my-dist --patch-target ../bug-repo

# Watch mode with default location
bun scripts/sync-to-dist.ts --watch

# Watch mode with patch target
bun scripts/sync-to-dist.ts --patch-target ../bug-repo --watch

# All options combined
bun scripts/sync-to-dist.ts --dist ../my-dist --patch-target ../bug-repo --watch

# Show help
bun scripts/sync-to-dist.ts --help

# Via mono CLI
bun scripts/mono.ts sync-to-dist [--dist <path>] [--patch-target <path>] [--watch]
```

## Prerequisites

1. **Write access to target directory** - The directory will be created if it
   doesn't exist
2. **rsync installed** - Used for efficient file synchronization

## Integration with Projects

### Manual Integration

After running the sync, configure your pnpm projects to use the distribution
directory with file protocol overrides:

```json
{
  "pnpm": {
    "overrides": {
      "@livestore/utils": "file:../livestore-dist/utils",
      "@livestore/common": "file:../livestore-dist/common",
      "@livestore/react": "file:../livestore-dist/react"
    }
  }
}
```

Then run `pnpm install` in your project to use the synced packages.

### Automatic Integration with Patch Target

Use the `--patch-target` option to automatically handle project setup:

```bash
# Automatically patches ../bug-repo/package.json and runs pnpm install
bun scripts/sync-to-dist.ts --patch-target ../bug-repo
```

This will:
1. Sync LiveStore packages to the distribution directory
2. Generate pnpm overrides for all available packages
3. Update the target project's `package.json` with the overrides
4. Run `pnpm install` in the target project

**Requirements for patch target:**
- Must be a valid directory
- Must contain a `package.json` file
- Must have read/write permissions

## How It Works

### 1. Target Directory Validation

- Creates target directory if it doesn't exist
- Verifies write access to the target location

### 2. Package Discovery

- Scans `packages/@livestore/` directory for available packages
- Lists all packages that will be synced

### 3. Distribution Sync

- Uses efficient rsync operation to sync entire `@livestore` directory structure
- Creates clean mirror: `target-dir/utils/`, `target-dir/common/`, etc.
- Excludes: `node_modules/`, `.git/`, temp files, TypeScript build artifacts (`*.tsbuildinfo`)
- Preserves file permissions and symlinks

### 4. Watch Mode (Optional)

- Uses Effect's native `FileSystem.watch` for cross-platform file monitoring
- Watches `packages/@livestore/` directories for changes
- Debounces file changes (300ms) to avoid excessive syncing
- Automatically triggers distribution sync when any source file changes

## Directory Structure

### Distribution Directory Structure

```
livestore-dist/                # Target distribution directory
├── utils/                     # From packages/@livestore/utils/
│   ├── dist/                  # Built files
│   ├── src/                   # Source files
│   ├── package.json           # Package metadata
│   └── tsconfig.json          # TypeScript config
├── common/                    # From packages/@livestore/common/
│   ├── dist/
│   ├── src/
│   └── package.json
├── react/                     # From packages/@livestore/react/
│   ├── dist/
│   ├── src/
│   └── package.json
└── ...                        # All other @livestore packages
```

### Project Integration

```
your-project/
├── package.json              # Contains pnpm overrides pointing to ../livestore-dist/
├── pnpm-lock.yaml
└── node_modules/
    └── @livestore/
        ├── utils/             # Symlinked to ../../../livestore-dist/utils/
        ├── common/            # Symlinked to ../../../livestore-dist/common/
        └── react/             # Symlinked to ../../../livestore-dist/react/
```

## Features

- ✅ **Direct file replacement** - No symlink chains
- ✅ **Live reloading** - Changes in LiveStore source appear immediately
- ✅ **Automatic project setup** - `--patch-target` handles pnpm overrides and installation
- ✅ **Flexible configuration** - Custom dist paths and target projects
- ✅ **Efficient watching** - Native file system events via Effect's FileSystem.watch
- ✅ **Debounced updates** - Intelligent batching of file changes
- ✅ **Error handling** - Comprehensive validation and error reporting
- ✅ **Preserves pnpm structure** - Maintains pnpm's dependency management

## Example Output

### Basic Sync

```
🔄 LiveStore Distribution Sync CLI

✓ Distribution directory validated: /Users/user/Code/livestore-dist
🔍 Preparing distribution directory sync...
✓ Found 18 LiveStore packages to sync
  - @livestore/utils
  - @livestore/common
  - @livestore/react
  ... (15 more packages)

🔄 Syncing LiveStore packages to distribution directory...
✅ Successfully synced LiveStore packages to: /Users/user/Code/livestore-dist
✅ Distribution sync completed!

💡 Tip: Use --watch to automatically sync changes
```

### With Patch Target

```
🔄 LiveStore Distribution Sync CLI

✓ Distribution directory validated: /Users/user/Code/livestore-dist
🔍 Preparing distribution directory sync...
✓ Found 18 LiveStore packages to sync
  ... (package list)

🔄 Syncing LiveStore packages to distribution directory...
✅ Distribution sync completed!

🎯 Patching target project: /Users/user/Code/bug-repo
✓ Patch target validated: /Users/user/Code/bug-repo
🔍 Generating pnpm overrides for distribution packages...
✓ Generated 18 pnpm overrides
  - @livestore/utils: file:/Users/user/Code/livestore-dist/utils
  - @livestore/common: file:/Users/user/Code/livestore-dist/common
  ... (16 more overrides)

📝 Updating package.json with pnpm overrides...
✓ Successfully updated package.json with 18 overrides
📦 Running pnpm install in patch target...
✅ pnpm install completed successfully
✅ Patch target setup completed!

💡 Tip: Use --watch to automatically sync changes
```

### Watch Mode Output

```
👀 Starting watch mode...
Press Ctrl+C to stop watching
✅ Watching /path/to/livestore/packages/@livestore for changes...

📁 Change detected in @livestore/utils
  ✓ Synced: @livestore/utils
```

## Development Workflow

### Initial Setup

1. **Create distribution directory**:
   ```bash
   # From LiveStore monorepo
   bun scripts/sync-to-dist.ts
   ```

2. **Configure external project**:
   ```json
   // In your external project's package.json
   {
     "pnpm": {
       "overrides": {
         "@livestore/utils": "file:../livestore-dist/utils",
         "@livestore/common": "file:../livestore-dist/common",
         "@livestore/react": "file:../livestore-dist/react"
       }
     }
   }
   ```

3. **Install dependencies**:
   ```bash
   # In your external project
   pnpm install
   ```

### Development with Live Reloading

#### Option 1: Manual Setup

1. **Start watch mode**:
   ```bash
   # In LiveStore monorepo (one terminal)
   bun scripts/sync-to-dist.ts --watch
   ```

2. **Start your external project**:
   ```bash
   # In your external project (another terminal)  
   pnpm dev
   ```

3. **Edit LiveStore source**:
   - Make changes to files in `packages/@livestore/utils/src/`
   - Watch mode automatically syncs changes to `../livestore-dist/`
   - Your external project hot-reloads with the updates

#### Option 2: Automatic Setup with Patch Target

1. **Start watch mode with patch target**:
   ```bash
   # In LiveStore monorepo (one terminal)
   bun scripts/sync-to-dist.ts --patch-target ../bug-repo --watch
   ```
   
   This automatically:
   - Syncs packages to distribution directory
   - Updates `../bug-repo/package.json` with pnpm overrides
   - Runs `pnpm install` in the target project

2. **Start your external project**:
   ```bash
   # In your external project (another terminal)  
   pnpm dev
   ```

3. **Edit LiveStore source**:
   - Make changes to files in `packages/@livestore/utils/src/`
   - Watch mode automatically syncs changes to distribution directory
   - Your external project hot-reloads with the updates

This gives you seamless development experience across the LiveStore monorepo and
external projects!

## Troubleshooting

### "Failed to create target directory"

- Check write permissions to the parent directory
- Ensure the path doesn't contain invalid characters

### "Target directory is not writable"

- Verify you have write permissions to the target directory
- Check if the directory is being used by another process

### Watch mode not detecting changes

- Ensure you're editing files in `packages/@livestore/` (not in distribution
  directories)
- Check that rsync is installed and accessible in your PATH

### External project not picking up changes

- Verify pnpm overrides are correctly configured in package.json
- Run `pnpm install` again after adding/changing overrides
- Check that the file paths in overrides match your distribution directory
  structure
- If using `--patch-target`, the overrides should be automatically configured

### Patch target setup fails

- Ensure the patch target directory exists and contains a `package.json`
- Check that you have read/write permissions to the target directory
- Verify that pnpm is installed and accessible in your PATH

## Technical Details

- **File Watcher**: Uses API-compatible `@parcel/watcher` implementation for cross-platform
  recursive file system events (until Effect native recursive watching is available)
- **Sync Method**: Efficient `rsync` operations with parallel execution
- **Debouncing**: 300ms delay to batch rapid file changes
- **Exclusions**: Automatically excludes `node_modules/`, `.git/`, temporary
  files, TypeScript build info files (`*.tsbuildinfo`)
- **Architecture**: Built on Effect framework with streams and proper resource
  management
- **Patch Target**: Automatically generates pnpm overrides and runs pnpm install
  for seamless project setup
