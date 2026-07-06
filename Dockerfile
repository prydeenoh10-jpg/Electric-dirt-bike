FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ARG CACHEBUST=1
RUN NODE_OPTIONS=--max-old-space-size=3072 npm run build

# medusa build now outputs to .medusa/server (tsconfig outDir fixed)
RUN cd .medusa/server && npm install --production

ENV NODE_ENV=production

CMD ["sh", "-c", "cd /app/.medusa/server && npx medusa start --verbose -H 0.0.0.0 -p ${PORT:-9000}"]
