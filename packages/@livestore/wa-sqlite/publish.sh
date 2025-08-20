#! /bin/bash

set -ex

npm version patch --no-git-tag-version

npm publish --access=public
