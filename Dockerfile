FROM node:24-bookworm-slim

ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Adapter entrypoint convention. Adapter images provide /app/adapter/adapter.js.
RUN mkdir -p /app/adapter

# Install only production dependencies.
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy application code.
COPY . .

CMD ["node", "index.js"]
