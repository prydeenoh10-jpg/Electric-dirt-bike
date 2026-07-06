# Mirrors the Railway Medusa v2 boilerplate approach (rpuls/medusajs-2.0-for-railway-boilerplate):
#   build  → medusa build, then npm install --production inside .medusa/server
#   start  → cd .medusa/server && medusa start
# Single-stage keeps the pattern simple and avoids cross-stage COPY path issues.

FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# medusa build outputs compiled server + admin to .medusa/server
RUN NODE_OPTIONS=--max-old-space-size=3072 npm run build

# Install production deps inside the build output (Railway postBuild equivalent)
RUN cd .medusa/server && npm install --production

ENV NODE_ENV=production

# Railway template: cd .medusa/server && medusa start --verbose
# Port and host via CLI flags so Render/Railway $PORT is respected.
CMD ["sh", "-c", "cd /app/.medusa/server && npx medusa start --verbose -H 0.0.0.0 -p ${PORT:-9000}"]
