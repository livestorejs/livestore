FROM oven/bun:1.3.13 AS bun

FROM node:24-bookworm-slim

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

COPY package.json ./
RUN npm install --global "$(node -p "require('./package.json').packageManager")"

COPY . .

RUN node --version \
  && bun --version \
  && pnpm --version \
  && pnpm install --frozen-lockfile \
  && pnpm exec tsc -b packages/@livestore/livestore --pretty false \
  && pnpm --filter @livestore/common exec vitest run src/schema/EventSequenceNumber.test.ts
