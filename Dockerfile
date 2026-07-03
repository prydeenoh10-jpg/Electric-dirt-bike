FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN NODE_OPTIONS=--max-old-space-size=1536 npm run build

# .medusa/server exists in this same layer — no cross-stage copy needed.
WORKDIR /app/.medusa/server

RUN npm install --production

ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=1536

CMD ["sh", "-c", "npx medusa start -H 0.0.0.0 -p ${PORT:-9000}"]
