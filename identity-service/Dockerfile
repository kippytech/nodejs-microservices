# ==========================
# Base
# ==========================
FROM node:24-alpine AS base

WORKDIR /app

COPY package*.json ./

# ==========================
# Development
# ==========================
FROM base AS development

ENV NODE_ENV=development

RUN npm ci

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]

# ==========================
# Production
# ==========================
FROM base AS production

ENV NODE_ENV=production

RUN npm ci --omit=dev

COPY . .

EXPOSE 3000

CMD ["npm", "start"]