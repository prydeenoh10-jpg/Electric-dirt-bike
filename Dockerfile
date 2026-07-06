FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ARG CACHEBUST=1

RUN NODE_OPTIONS=--max-old-space-size=3072 npm run build && \
    echo "=== find medusa-config* ===" && find /app -name "medusa-config*" 2>/dev/null && \
    echo "=== /app/.medusa ===" && find /app/.medusa -maxdepth 3 2>/dev/null || echo "no .medusa dir" && \
    DIR=$(dirname $(find /app -name "medusa-config.js" | head -1)) && \
    echo "=== installing prod deps in $DIR ===" && \
    cd "$DIR" && npm install --production

ENV NODE_ENV=production

CMD ["sh", "-c", "DIR=$(dirname $(find /app -name medusa-config.js | head -1)); cd $DIR && npx medusa start --verbose -H 0.0.0.0 -p ${PORT:-9000}"]
