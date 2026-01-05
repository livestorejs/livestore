#! /bin/bash

# This script is used to bootstrap the project.

# TODO validate correct node version, bun version, etc. are installed

direnv allow
bun install --no-progress
bun run build
