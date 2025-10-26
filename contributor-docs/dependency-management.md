# Dependency Management Guide

Update all NPM dependencies across the entire monorepo using the automated TypeScript script.

## Quick Start

```bash
# 1. Dry run to preview changes
direnv exec . mono update-deps --dry-run

# 2. Execute updates (Expo constraints applied globally for consistency)
direnv exec . mono update-deps

# 3. Review changes  
git diff package.json packages/*/package.json examples/*/package.json pnpm-lock.yaml

# 4. Update version constants (see below)
```

## Script Options

```bash
# Available options:
--dry-run         # Preview changes without executing updates
--target          # Update target: latest, minor, patch (default: minor)  
--validate        # Run validation after updates (default: true)

# Examples:
direnv exec . mono update-deps --target patch --dry-run
direnv exec . mono update-deps --validate false
```

## Version Constants Update

After updating dependencies, check if version constants in `packages/@local/shared/src/CONSTANTS.ts` need updates:

- Look for constants that reference dependency versions (e.g., `*_VERSION` exports)
- Update constants when their corresponding dependencies are updated
- Common patterns: Framework versions, runtime requirements, tool versions

## PNPM Catalog Management

The catalog is used for:
- ✅ Regular dependencies
- ✅ Dev dependencies  
- ❌ Peer dependencies (use explicit versions)

### Adding to Catalog
Add dependencies to the catalog (`pnpm-workspace.yaml`) when used in **3 or more packages** (excluding examples):

```bash
# Check for repeated dependencies (excluding examples)
grep -r '"package-name"' packages/*/package.json docs/package.json tests/*/package.json | wc -l
```

## Peer Dependencies Policy

Peer dependencies must use **explicit version ranges** instead of catalog references. This ensures:
- Published packages have the correct version ranges
- Users can install packages without version conflicts
- Clear visibility of compatibility requirements

### Guidelines
- Use `^` (caret) for peer dependencies to allow minor updates
- Keep peer dependencies in sync with catalog versions manually
- When updating catalog versions, also update corresponding peer dependencies

### Example
```json
// ❌ Don't use catalog for peer deps
"peerDependencies": {
  "react": "catalog:"
}

// ✅ Use explicit version with range
"peerDependencies": {
  "react": "^19.0.0"
}
```

### Enforcement
Syncpack is configured to:
- NOT enforce catalog protocol for peer dependencies
- Enforce `^` range for all peer dependencies
- Keep peer dependency versions consistent across packages

## Expected Warnings

These warnings are normal and can be ignored:
- **npm config warnings:** "Unknown project config dedupe-direct-deps", etc.
- **Peer dependency warnings:** Generally safe unless causing build failures
- **Catalog warnings:** "Skip adding to catalog because it already exists"

## Validation Checklist

After dependency updates, verify these meta-items:

- [ ] `bunx expo install --check` passes for all Expo examples
- [ ] Version constants updated appropriately
- [ ] TypeScript build passes: `mono ts`
- [ ] Linting passes: `mono lint` (run `mono lint --fix` if needed)

## Troubleshooting

**"Command not found" errors:** Use `direnv exec .` prefix for all commands

**Script execution issues:** Ensure TypeScript builds pass: `direnv exec . mono ts`

**Expo compatibility:** Check [Expo SDK docs](https://docs.expo.dev/versions/latest/) before updating React

**Update failures:** If updates break the build, rollback with `git checkout .` and update manually

**Large number of updates:** Review changes with `git diff` before committing

**Problematic dependencies:** When specific packages fail to update:

1. **Research first:** Check GitHub issues, search `"package-name" + "version" + "error"`, review changelog/releases (also try without the version number)

2. **Continue with others:** Focus on specific problematic packages

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