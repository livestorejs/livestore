# Request: Get ACT Working for Node-Sync Integration Tests

## Objective
Set up and successfully run the `test-integration-node-sync` GitHub Actions job locally using [act](https://github.com/nektos/act) to reproduce CI timeout issues.

## Background
We're debugging intermittent timeout issues in our node-sync integration tests that only occur on the first CI run. The tests timeout after 8+ minutes when creating 278 todos with batch size 1. We need to reproduce this locally with resource constraints similar to GitHub Actions.

## Current Setup

### Project Structure
- **Build System**: Nix + direnv + pnpm monorepo
- **Test Framework**: Vitest
- **Test Location**: `tests/integration/src/tests/node-sync/node-sync.test.ts`
- **CI Platform**: GitHub Actions

### Relevant Files

#### 1. GitHub Actions Workflow (`.github/workflows/ci.yml`)
```yaml
test-integration-node-sync:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - name: Set up environment
      uses: ./.github/actions/setup-env
    - name: Set OTEL_EXPORTER_OTLP_HEADERS environment variable
      env:
        GRAFANA_CLOUD_OTLP_INSTANCE_ID: 1227256
        GRAFANA_CLOUD_OTLP_API_KEY: ${{ secrets.GRAFANA_CLOUD_OTLP_API_KEY }}
      run: |
        echo "OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic $(echo -n "$GRAFANA_CLOUD_OTLP_INSTANCE_ID:$GRAFANA_CLOUD_OTLP_API_KEY" | base64 -w 0)" >> $GITHUB_ENV
        echo "GRAFANA_ENDPOINT=https://livestore.grafana.net" >> $GITHUB_ENV
        echo "OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-us-east-2.grafana.net/otlp" >> $GITHUB_ENV
        echo "VITE_OTEL_EXPORTER_OTLP_ENDPOINT=" >> $GITHUB_ENV
    - run: mono test integration node-sync
```

#### 2. Setup Environment Action (`.github/actions/setup-env/action.yml`)
```yaml
name: Set up environment
description: Set up the environment with Nix and direnv.
runs:
  using: composite
  steps:
    - name: Install Determinate Nix
      uses: DeterminateSystems/determinate-nix-action@v3
    - name: Use FlakeHub Cache for Nix binaries
      uses: DeterminateSystems/flakehub-cache-action@main
    - name: Get pnpm store directory
      id: pnpm-store
      shell: bash
      run: echo "DIR_PATH=$(nix develop ./nix --command pnpm store path --silent)" >> $GITHUB_OUTPUT
    - name: Cache pnpm store
      uses: actions/cache@v4
      with:
        path: ${{ steps.pnpm-store.outputs.DIR_PATH }}
        key: ${{ runner.os }}-pnpm-store-${{ hashFiles('**/pnpm-lock.yaml') }}
        restore-keys: ${{ runner.os }}-pnpm-store-
    - name: Cache direnv setup
      uses: actions/cache@v4
      with:
        path: .direnv
        key: direnv-${{ runner.os }}-${{ hashFiles('.envrc', 'nix/**', 'flake.nix', 'flake.lock', 'scripts/standalone/setup.ts') }}-${{ github.sha }}
        restore-keys: direnv-${{ runner.os }}-${{ hashFiles('.envrc', 'nix/**', 'flake.nix', 'flake.lock', 'scripts/standalone/setup.ts') }}-
    - name: Install direnv
      shell: bash
      run: nix profile add nixpkgs#direnv
    - name: Load environment with direnv
      shell: bash
      run: |
        direnv allow
        direnv exec . sh -c 'echo $PATH' > "$GITHUB_PATH"
        direnv export gha >> "$GITHUB_ENV"
```

### The Test Command
The actual test runs: `mono test integration node-sync`

Which internally executes:
```bash
direnv exec . vitest run src/tests/node-sync/node-sync.test.ts
```

## Problems Encountered with ACT

1. **Initial run hangs**: `act -j test-integration-node-sync` times out during container setup
2. **Complex Nix setup**: The workflow uses Nix and direnv which need to work inside Docker
3. **Custom composite actions**: The `.github/actions/setup-env` action needs to be handled
4. **Resource constraints needed**: Should run with `--container-options "--cpus=1 --memory=2g"`

## Attempted Commands That Failed

```bash
# Basic attempt - hangs indefinitely
nix shell nixpkgs#act --command act -j test-integration-node-sync -W .github/workflows/ci.yml

# With resource constraints - also hangs
nix shell nixpkgs#act --command act -j test-integration-node-sync \
  -W .github/workflows/ci.yml \
  --container-options "--cpus=1 --memory=2g"

# Even dry run times out
nix shell nixpkgs#act --command act -j test-integration-node-sync \
  -W .github/workflows/ci.yml \
  --dryrun
```

## Desired Outcome

1. **Get act running** with the node-sync integration test job
2. **Apply resource constraints** to simulate GitHub Actions environment (1 CPU, 2GB RAM)
3. **Set CI environment variables**: `CI=true`, `GITHUB_ACTIONS=true`
4. **Successfully run** the test to completion or timeout

## Potential Solutions to Explore

1. **Custom Docker image** with Nix pre-installed
2. **Simplified workflow** specifically for act (without composite actions)
3. **act configuration file** (`.actrc`) with proper settings
4. **Medium/large Docker images**: Try `-P ubuntu-latest=catthehacker/ubuntu:full-latest`
5. **Skip caching steps**: Use `--action-offline-mode` or modify workflow

## Success Criteria

- Act successfully starts and runs the test-integration-node-sync job
- The test either completes or times out (both outcomes are useful for debugging)
- Resource constraints are applied (1 CPU, 2GB RAM)
- All logs are visible to debug the timeout issue

## Alternative Approach (If ACT fails)

We've successfully simulated CI by running:
```bash
CI=true GITHUB_ACTIONS=true IS_CI=true \
  direnv exec . mono test integration node-sync
```

But having act working would be better for accurate CI reproduction.

## Environment Details

- **OS**: Linux (NixOS/Ubuntu)
- **Docker**: Available and running
- **Nix**: Already installed
- **act version**: 0.2.77 (via `nix shell nixpkgs#act`)

## Additional Context

- The timeout occurs when FastCheck property tests generate scenarios with many todos (200+) and small batch sizes
- Tests pass locally without resource constraints
- We've added debug logging but need to reproduce the exact CI environment to catch the timeout

## Files to Reference

- `.github/workflows/ci.yml` - Main CI workflow
- `.github/actions/setup-env/action.yml` - Custom setup action
- `.envrc` - direnv configuration
- `flake.nix` - Nix flake configuration
- `tests/integration/src/tests/node-sync/node-sync.test.ts` - The actual test file

## Questions for Investigation

1. Can act handle Nix flakes and direnv properly?
2. Should we create a Docker image with our Nix environment pre-built?
3. Is there a way to bypass the composite action and inline its steps?
4. Would nectos/act or another act fork work better with Nix?

---

**Note**: The repository is at https://github.com/livestorejs/livestore and the specific issue is tracked in CI runs where the first run times out but subsequent runs pass.