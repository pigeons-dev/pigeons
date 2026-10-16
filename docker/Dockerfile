FROM node:20-alpine AS builder

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY turbo.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile

COPY packages/core/ packages/core/
RUN pnpm --filter @pigeons/core build

FROM node:20-alpine

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=builder /app/packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/packages/core/dist packages/core/dist/
COPY --from=builder /app/packages/core/drizzle packages/core/drizzle/

RUN mkdir -p /app/packages/core/data

EXPOSE 3891
VOLUME ["/app/packages/core/data"]

WORKDIR /app/packages/core
CMD ["node", "dist/server.js"]
