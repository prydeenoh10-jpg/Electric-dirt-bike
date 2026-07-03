# ── Build stage ───────────────────────────────────────────────────────────────
# Needs dev deps (typescript, medusa CLI) to run `medusa build`.
FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Compiles TS + bundles admin UI → /app/.medusa/server
# Raise heap: Vite admin compile can exceed the Node default 256 MB.
RUN NODE_OPTIONS=--max-old-space-size=1536 npm run build

# ── Production stage ──────────────────────────────────────────────────────────
# Only the built output lands in the final image — no source, no dev deps.
FROM node:20-slim

WORKDIR /app

# Copy the contents of .medusa/server to /app (not the folder itself).
# This puts medusa-config.js, src/, public/admin/index.html etc. at root,
# which is exactly what `medusa start` checks for when validating the project.
COPY --from=builder /app/.medusa/server .

# Install the production deps declared by the build-generated package.json.
RUN npm install --production

EXPOSE 9000

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV NODE_OPTIONS=--max-old-space-size=1536

CMD ["npx", "medusa", "start"]
