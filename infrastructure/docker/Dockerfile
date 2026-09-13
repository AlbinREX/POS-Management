FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY . .
RUN npm ci
RUN npm run db:generate
RUN npm run build:api
RUN npm run build -w @restaurant/admin

FROM build AS migrate
CMD ["node", "scripts/migrate.mjs"]

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app /app
RUN npm prune --omit=dev --ignore-scripts
USER node

FROM runtime AS api
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]

FROM runtime AS admin
WORKDIR /app/apps/admin
EXPOSE 3000
CMD ["../../node_modules/.bin/next", "start", "--hostname", "0.0.0.0"]
