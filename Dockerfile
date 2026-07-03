FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN NODE_OPTIONS=--max-old-space-size=1536 npm run build

# ── Diagnostic ───────────────────────────────────────────────────────────────
# These lines print to Render's build log so we can see the actual output path.
RUN echo "=== /app root ===" && ls -la /app/ && \
    echo "=== /app/.medusa ===" && (ls -la /app/.medusa/ 2>/dev/null || echo "[NOT FOUND]") && \
    echo "=== /app/.medusa/server ===" && (ls -la /app/.medusa/server/ 2>/dev/null || echo "[NOT FOUND]") && \
    echo "=== medusa-config.js locations ===" && \
    find /app -name "medusa-config.js" -not -path "*/node_modules/*" 2>/dev/null || echo "[none found]"

# Install production deps inside the built output.
# If the build put server files somewhere other than .medusa/server the
# diagnostic above will show the real path — update the cd target here.
RUN cd /app/.medusa/server && npm install --production

EXPOSE 9000

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV NODE_OPTIONS=--max-old-space-size=1536

# Shell form so the cd is evaluated at container start.
CMD sh -c "cd /app/.medusa/server && npx medusa start"
