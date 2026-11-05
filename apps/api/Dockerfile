# Build context: repo root
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@10.34.9

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

RUN pnpm install --frozen-lockfile --filter api...
RUN pnpm --filter @visitor/shared build
RUN cd apps/api && npx prisma generate && pnpm build

WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 3000
# Ek hi instance hai, isliye migration start par safe hai.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
