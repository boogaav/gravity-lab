# ---- build the frontend ----
FROM --platform=linux/amd64 node:22-slim AS web
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
# Privy app id is baked in at build time (it is a public identifier).
# Empty means accounts are disabled and the SDK is never even downloaded.
ARG VITE_PRIVY_APP_ID=""
ENV VITE_PRIVY_APP_ID=$VITE_PRIVY_APP_ID
RUN npx vite build --base=/

# ---- runtime: API + static ----
FROM --platform=linux/amd64 node:22-slim AS runtime
ENV NODE_ENV=production
# toolchain so better-sqlite3 can compile if no matching prebuilt binary exists
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Copy sources first, then install: installing last guarantees node_modules is
# produced in (and matches) this image rather than being overwritten by a COPY.
COPY server ./server
RUN cd server && npm install --omit=dev --no-audit --no-fund
COPY --from=web /app/dist ./dist
EXPOSE 8080
CMD ["node", "server/index.mjs"]
