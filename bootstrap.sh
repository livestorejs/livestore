#! /bin/bash

# This script is used to bootstrap the project.

# TODO validate correct node version, pnpm version, etc. are installed

direnv allow
pnpm install
pnpm build