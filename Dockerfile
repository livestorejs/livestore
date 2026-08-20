FROM oven/bun:1.3.13 AS bun

# Node 24 and Bun 1.3.13 are the known-good portable toolchain.
FROM node:24-bookworm-slim

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

COPY package.json ./
RUN npm install --global "$(node -p "require('./package.json').packageManager")"

COPY . .

# The image has no Git metadata, so docs links intentionally target main.
ENV GITHUB_BRANCH_NAME=main

RUN ./scripts/bootstrap-minimal.sh \
  # Keep this finite oracle representative; interactive and full-lane work runs outside the build.
  && pnpm exec tsc -b packages/@livestore/livestore --pretty false \
  && pnpm --filter @livestore/common exec vitest run \
  && pnpm --filter livestore-example-web-todomvc run build \
  && pnpm --filter livestore-example-cloudflare-todomvc run build \
  && pnpm --filter @local/docs run check
