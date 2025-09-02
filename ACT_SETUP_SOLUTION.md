# ACT Setup Solution for Node-Sync Integration Tests

## Overview
This document provides multiple approaches to run the node-sync integration tests locally with ACT to reproduce CI timeout issues.

## Approach 1: Direct CI Simulation (Recommended)

The simplest approach that works without ACT complexities:

```bash
# Run the provided script
./run-ci-simulation.sh

# Or run directly:
CI=true GITHUB_ACTIONS=true IS_CI=true \
  direnv exec . mono test integration node-sync
```

### With Resource Constraints (Linux with systemd)
```bash
systemd-run --scope \
  --property=CPUQuota=100% \
  --property=MemoryMax=2G \
  --uid=$(id -u) \
  --gid=$(id -g) \
  --setenv=CI=true \
  --setenv=GITHUB_ACTIONS=true \
  --setenv=IS_CI=true \
  bash -c "direnv exec . mono test integration node-sync"
```

## Approach 2: ACT with Simplified Workflow

### Setup
1. Created simplified workflows:
   - `.github/workflows/act-node-sync.yml` - Container-based with Nix
   - `.github/workflows/act-node-sync-host.yml` - Host-based approach

2. Configuration file `.actrc` with defaults

### Running ACT

```bash
# Using the simplified workflow
nix shell nixpkgs#act --command act \
  -W .github/workflows/act-node-sync.yml \
  -j test-integration-node-sync \
  --container-options "--cpus=1 --memory=2g" \
  -P ubuntu-latest=catthehacker/ubuntu:full-latest

# Or with the .actrc file (contains all defaults)
nix shell nixpkgs#act --command act
```

## Approach 3: Custom Docker Image (Advanced)

For better ACT compatibility, build a custom Docker image:

```bash
# Build the custom image
docker build -f Dockerfile.act -t livestore-act:latest .

# Use with ACT
nix shell nixpkgs#act --command act \
  -W .github/workflows/act-node-sync.yml \
  -j test-integration-node-sync \
  --container-options "--cpus=1 --memory=2g" \
  -P ubuntu-latest=livestore-act:latest
```

## Files Created

1. **`.github/workflows/act-node-sync.yml`**
   - Simplified workflow using Nix container
   - Installs dependencies inside container
   - Runs tests with timeout

2. **`.github/workflows/act-node-sync-host.yml`**
   - Host-based approach
   - Uses existing Nix/direnv setup
   - Fallback strategies for different environments

3. **`.actrc`**
   - ACT configuration with defaults
   - Sets resource constraints
   - Configures environment variables

4. **`run-ci-simulation.sh`**
   - Direct CI simulation script
   - Optional systemd resource constraints
   - Automatic log display on failure

5. **`Dockerfile.act`**
   - Custom Docker image with Nix pre-installed
   - Configured for ACT compatibility
   - Includes common dependencies

## Troubleshooting

### ACT Hangs During Setup
- Use `--pull=false` if you've already pulled images
- Try `--reuse` to reuse containers between runs
- Use `--verbose` for detailed output

### Nix Issues in Docker
- The custom Dockerfile.act addresses most Nix-in-Docker issues
- Ensure Docker has enough resources allocated
- Use `--privileged` if sandbox issues occur

### Resource Constraints Not Applied
- Verify Docker daemon supports resource limits
- Check `docker info` for cgroup version
- On some systems, use `--container-options "--cpus=1.0 --memory=2048m"`

### Tests Still Don't Timeout
- Verify CI environment variables are set
- Check that resource constraints are actually applied
- Monitor with `docker stats` during test run

## Testing Resource Constraints

Verify constraints are working:

```bash
# While tests are running in another terminal:
docker stats --no-stream

# Or monitor continuously:
docker stats
```

## Why Tests Timeout in CI

The timeout occurs due to:
1. **Resource constraints**: CI has 1 CPU, 2GB RAM
2. **FastCheck scenarios**: Large todo counts (200+) with batch size 1
3. **First run effect**: No warm caches, cold JIT compilation

## Next Steps

1. Run tests with the simulation script to reproduce timeout
2. If timeout reproduced, debug with enhanced logging already in place
3. If ACT needed for exact CI reproduction, use custom Docker image approach

## Alternative: GitHub Codespaces

If ACT continues to be problematic, consider:
```bash
# Use GitHub Codespaces with similar constraints
gh codespace create --machine basicLinux32gb
gh codespace ssh -- "cd /workspaces/livestore && CI=true mono test integration node-sync"
```

## Summary

The most reliable approach is the direct CI simulation script (`./run-ci-simulation.sh`). ACT adds complexity due to Docker-in-Docker and Nix interactions. The custom Docker image approach provides the best ACT compatibility if exact GitHub Actions reproduction is required.