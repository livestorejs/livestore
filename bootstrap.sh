#! /bin/bash

# This script is used to bootstrap the project.

direnv allow
pnpm install
pnpm build