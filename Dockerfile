FROM oven/bun:1.3.13 AS bun

# Node 24 and Bun 1.3.13 are the known-good portable toolchain.
FROM node:24-bookworm-slim

# bunx is a symlink to the same binary; recreate it so `bunx ...` commands work.
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s bun /usr/local/bin/bunx

WORKDIR /app

COPY package.json ./
RUN npm install --global "$(node -p "require('./package.json').packageManager")"

COPY . .

# The image build has no Git metadata (see .dockerignore), so docs links during the
# oracle run intentionally target main. `export` scopes the override to this single
# RUN (an env prefix would only cover the first command): interactive Compose users
# keep their real branch, resolved from the bind-mounted checkout's Git.
RUN export GITHUB_BRANCH_NAME=main \
  && ./scripts/bootstrap-minimal.sh \
  # Keep this finite oracle representative; interactive and full-lane work runs outside the build.
  && pnpm exec tsc -b packages/@livestore/livestore --pretty false \
  && pnpm --filter @livestore/common exec vitest run \
  && pnpm --filter livestore-example-web-todomvc run build \
  && pnpm --filter livestore-example-cloudflare-todomvc run build \
  && pnpm --filter @local/docs run check
