# Build stage: full workspace with dev dependencies, used only to compile.
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY . .
RUN npm ci
RUN npm run db:generate
RUN npm run build:api
RUN npm run build -w @restaurant/admin

# Production dependency tree, resolved in isolation so no dev binary can survive into a
# runtime image. Pruning a tree that already contains dev packages leaves their binaries
# and transitive files behind; installing fresh with --omit=dev does not.
FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY packages/database/package.json packages/database/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/validation/package.json packages/validation/
COPY packages/ui/package.json packages/ui/
COPY packages/config/package.json packages/config/
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
RUN npm ci --omit=dev --ignore-scripts

# Migration image: needs the Prisma CLI and the migration SQL, and nothing else. It runs
# once with owner credentials and exits, so it is kept separate from the serving images.
FROM node:24-bookworm-slim AS migrate
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/node_modules /app/node_modules
COPY --from=build --chown=node:node /app/package.json /app/package.json
COPY --from=build --chown=node:node /app/prisma.config.ts /app/prisma.config.ts
COPY --from=build --chown=node:node /app/scripts/migrate.mjs /app/scripts/migrate.mjs
COPY --from=build --chown=node:node /app/scripts/provision-runtime.mjs /app/scripts/provision-runtime.mjs
COPY --from=build --chown=node:node /app/scripts/docker-seed.mjs /app/scripts/docker-seed.mjs
COPY --from=build --chown=node:node /app/packages/database /app/packages/database
COPY --from=build --chown=node:node /app/packages/shared-types /app/packages/shared-types
COPY --from=build --chown=node:node /app/packages/validation /app/packages/validation
USER node
CMD ["node", "scripts/migrate.mjs"]

# Runtime base: production dependencies only, no source, no tests, no dev tooling.
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=deps --chown=node:node /app/node_modules /app/node_modules
COPY --from=build --chown=node:node /app/package.json /app/package.json
# The generated Prisma client is build output, not source, and the runtime requires it.
COPY --from=build --chown=node:node /app/packages/database/package.json /app/packages/database/package.json
COPY --from=build --chown=node:node /app/packages/database/dist /app/packages/database/dist
COPY --from=build --chown=node:node /app/packages/database/src/generated /app/packages/database/src/generated
COPY --from=build --chown=node:node /app/packages/shared-types/package.json /app/packages/shared-types/package.json
COPY --from=build --chown=node:node /app/packages/shared-types/dist /app/packages/shared-types/dist
COPY --from=build --chown=node:node /app/packages/validation/package.json /app/packages/validation/package.json
COPY --from=build --chown=node:node /app/packages/validation/dist /app/packages/validation/dist
USER node

FROM runtime AS api
COPY --from=build --chown=node:node /app/apps/api/package.json /app/apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist /app/apps/api/dist
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]

FROM runtime AS admin
COPY --from=build --chown=node:node /app/packages/ui /app/packages/ui
COPY --from=build --chown=node:node /app/apps/admin/package.json /app/apps/admin/package.json
COPY --from=build --chown=node:node /app/apps/admin/next.config.ts /app/apps/admin/next.config.ts
COPY --from=build --chown=node:node /app/apps/admin/.next /app/apps/admin/.next
COPY --from=build --chown=node:node /app/apps/admin/public /app/apps/admin/public
WORKDIR /app/apps/admin
EXPOSE 3000
CMD ["../../node_modules/.bin/next", "start", "--hostname", "0.0.0.0"]
