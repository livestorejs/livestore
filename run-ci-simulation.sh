#!/bin/bash

# CI simulation script for node-sync integration tests
# This script simulates GitHub Actions CI environment constraints

set -e

echo "=== Starting CI Simulation for node-sync integration tests ==="
echo "Simulating GitHub Actions environment with resource constraints"
echo ""

# Set CI environment variables
export CI=true
export GITHUB_ACTIONS=true
export IS_CI=true

# Optional: Set resource constraints using systemd-run (if available)
if command -v systemd-run &> /dev/null; then
    echo "Running with systemd-run resource constraints (1 CPU, 2GB RAM)..."
    echo ""
    
    systemd-run --scope \
        --property=CPUQuota=100% \
        --property=MemoryMax=2G \
        --uid=$(id -u) \
        --gid=$(id -g) \
        --setenv=CI=true \
        --setenv=GITHUB_ACTIONS=true \
        --setenv=IS_CI=true \
        bash -c "direnv exec . mono test integration node-sync"
else
    echo "systemd-run not available, running without resource constraints"
    echo "CI environment variables set:"
    echo "  CI=$CI"
    echo "  GITHUB_ACTIONS=$GITHUB_ACTIONS"
    echo "  IS_CI=$IS_CI"
    echo ""
    
    # Run the test with direnv
    direnv exec . mono test integration node-sync
fi

# Display logs if the test fails
if [ $? -ne 0 ]; then
    echo ""
    echo "=== Test failed, displaying logs ==="
    if [ -d "tests/integration/tmp/logs" ]; then
        for log_file in tests/integration/tmp/logs/*.log; do
            if [ -f "$log_file" ]; then
                echo "--- $(basename "$log_file") ---"
                cat "$log_file"
                echo ""
            fi
        done
    else
        echo "No log files found"
    fi
fi