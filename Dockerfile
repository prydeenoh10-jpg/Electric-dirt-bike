FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN NODE_OPTIONS=--max-old-space-size=1536 npm run build

# Hard-fail if build didn't produce the expected output.
# Catches stale cache hits where .medusa/server is empty or missing.
RUN test -f /app/.medusa/server/medusa-config.js || \
    { echo "ERROR: medusa build did not produce /app/.medusa/server/medusa-config.js"; exit 1; }

# ── Production image ──────────────────────────────────────────────────────────
FROM node:20-slim

WORKDIR /app

# Copy contents of .medusa/server to /app root so medusa start finds
# medusa-config.js at process.cwd() and recognises this as a project.
COPY --from=builder /app/.medusa/server ./

RUN npm install --production

ENV NODE_ENV=production

CMD ["sh", "-c", "npx medusa start -H 0.0.0.0 -p ${PORT:-9000}"]
