FROM node:20-slim

WORKDIR /app

# Install all deps (dev deps are required for medusa build)
COPY package*.json ./
RUN npm ci

# Copy source — .dockerignore keeps node_modules and .medusa off the context
COPY . .

# Build: compiles TS + bundles admin UI → outputs to /app/.medusa/server
# Raise heap here; Vite admin compile can exceed the Node default 256 MB.
RUN NODE_OPTIONS=--max-old-space-size=1536 npm run build

# Install production deps declared by the build output's own package.json
WORKDIR /app/.medusa/server
RUN npm install --production

EXPOSE 9000

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV NODE_OPTIONS=--max-old-space-size=1536

# Start from .medusa/server so medusa-config.js and admin/index.html are found
CMD ["npx", "medusa", "start"]
