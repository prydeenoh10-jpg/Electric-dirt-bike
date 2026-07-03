FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN NODE_OPTIONS=--max-old-space-size=1536 npm run build

# ── Production image ──────────────────────────────────────────────────────────
FROM node:20-slim

WORKDIR /app

# Copy contents of .medusa/server to /app root.
# Result: /app/medusa-config.js, /app/package.json, /app/public/admin/…
COPY --from=builder /app/.medusa/server ./

RUN npm install --production

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV NODE_OPTIONS=--max-old-space-size=1536

CMD ["npx", "medusa", "start"]
