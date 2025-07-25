# Dependency Management Guide

This document outlines the process for updating NPM dependencies in the LiveStore project. We use `pnpm update` as our primary tool with `syncpack` for validation. Update all dependencies across the entire monorepo.

## Quick Start

```bash
# 0. Update PNPM itself first
pnpm --version  # Check current version
pnpm view pnpm version  # Check latest version
# Update via corepack: corepack use pnpm@latest

# 1. Get Expo-managed packages to exclude from updates
EXPO_SDK=$(pnpm view expo version | sed 's/\([0-9]*\.[0-9]*\)\..*/\1.0/')
EXPO_PACKAGES=$(direnv exec . curl -s https://api.expo.dev/v2/sdks/$EXPO_SDK/native-modules | jq -r '.data[].npmPackage')

# 2. Update all dependencies EXCEPT Expo-managed packages
# Note: Add --filter "!package-name" for any packages in patchedDependencies
EXPO_FILTERS=$(echo "$EXPO_PACKAGES" | sed 's/^/--filter "!/' | sed 's/$/"/' | tr '\n' ' ')
direnv exec . pnpm update --latest $EXPO_FILTERS

# 3. Review changes
git diff package.json packages/*/package.json examples/*/package.json pnpm-lock.yaml

# 4. Validate consistency and Expo compatibility
direnv exec . syncpack lint && direnv exec . syncpack fix-mismatches
for dir in examples/expo-*; do (cd "$dir" && bunx expo install --check); done

# 5. Update version constants and catalog (see below)
# 6. Test build and linting
direnv exec . mono ts && direnv exec . mono lint
```

## What Gets Updated

This process updates dependencies across:
- ✅ **Root package.json** - Development tools and workspace config
- ✅ **All package/* directories** - Individual package dependencies
- ✅ **All example/* directories** - Example application dependencies (no catalog usage)
- ✅ **Test directories** - Testing framework dependencies
- ✅ **Peer dependencies** - Automatically synced by syncpack
- ✅ **Package resolutions** - Updated as needed

## Exclusions

We exclude certain packages from automatic updates:

**Expo-managed packages:** Automatically excluded to ensure SDK compatibility
- All packages from Expo SDK API (react, react-native, expo-*, etc.)
- Prevents incompatible versions that break Expo examples

**Patched dependencies:** Packages with custom patches
- Check `patchedDependencies` in root `package.json` for current list

## Version Constants Update

After updating dependencies, check if version constants in `packages/@local/shared/src/CONSTANTS.ts` need updates:

- Look for constants that reference dependency versions (e.g., `*_VERSION` exports)
- Update constants when their corresponding dependencies are updated
- Common patterns: Framework versions, runtime requirements, tool versions

## PNPM Catalog Management

### Adding to Catalog
Add dependencies to the catalog (`pnpm-workspace.yaml`) when used in **3 or more packages** (excluding examples):

### Updating Catalog
Update catalog dependencies: `pnpm update --catalog`

### Finding Catalog Candidates
After updates, look for dependencies that appear across multiple packages:
```bash
# Check for repeated dependencies (excluding examples)
grep -r '"package-name"' packages/*/package.json tests/*/package.json | wc -l
```

## Expected Warnings

These warnings are normal and can be ignored:
- **npm config warnings:** "Unknown project config dedupe-direct-deps", etc.
- **Peer dependency warnings:** Generally safe unless causing build failures
- **Catalog warnings:** "Skip adding to catalog because it already exists"

## Manual Alternative

For complex updates or when automatic updates fail:

```bash
# 1. Check outdated packages
direnv exec . pnpm outdated --format json

# 2. Check specific package versions
direnv exec . pnpm view <package-name> version

# 3. Manually edit package.json files
# 4. Update lockfile
direnv exec . pnpm install --fix-lockfile

# 5. Validate consistency
direnv exec . syncpack lint && direnv exec . syncpack fix-mismatches
```

## Validation Checklist

After dependency updates, verify these meta-items:

- [ ] `bunx expo install --check` passes for all Expo examples
- [ ] Version constants updated appropriately
- [ ] TypeScript build passes: `mono ts`
- [ ] Linting passes: `mono lint` (run `mono lint --fix` if needed)
- [ ] Final `pnpm install --frozen-lockfile` passes

## Troubleshooting

**"Command not found" errors:** Use `direnv exec .` prefix for all commands

**Expo compatibility:** Check [Expo SDK docs](https://docs.expo.dev/versions/latest/) before updating React

**Update failures:** If updates break the build, rollback with `git checkout .` and update manually

**Large number of updates:** Review changes with `git diff` before committing

**Problematic dependencies:** When specific packages fail to update:

1. **Research first:** Check GitHub issues, search `"package-name" + "version" + "error"`, review changelog/releases (also try without the version number)

2. **Continue with others:** `direnv exec . pnpm update --latest --filter "!problematic-package" [other filters...]`

3. **Document findings:** Note exact error/versions, check peer conflicts, verify relation to exclusions (React/Expo/patches), test in isolation

4. **Ask for help only after research with:** Error messages/traces, version details (current → attempted), research findings, update blocking status

## Patched Dependencies

**Patched dependencies are excluded from automatic updates** to prevent conflicts.

To update patched dependencies manually:
1. Check if the patch is still needed in the new version
2. If needed, update the patch file for the new version
3. If not needed, remove from `patchedDependencies` configuration
4. Then run the update process

Current patched dependencies are listed in the root `package.json` under `pnpm.patchedDependencies`.