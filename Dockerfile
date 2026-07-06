FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN NODE_OPTIONS=--max-old-space-size=3072 npm run build && \
    echo "=== find output ===" && find /app -name "medusa-config*" && \
    echo "=== .medusa tree ===" && ls -la /app/.medusa/*/ 2>/dev/null

ENV NODE_ENV=production

CMD ["sh", "-c", "cd /app/.medusa/server && npx medusa start --verbose -H 0.0.0.0 -p ${PORT:-9000}"]
