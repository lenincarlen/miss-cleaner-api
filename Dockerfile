FROM node:20-alpine AS builder
RUN apk update && apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
COPY prisma ./prisma
COPY tsconfig.json ./
COPY src ./src

RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm prisma generate

FROM node:20-alpine AS runner
RUN apk update && apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs

COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package.json ./

RUN mkdir /app/uploads && chown nodejs:nodejs /app/uploads

ENV NODE_ENV=production
ENV PORT=8082
EXPOSE 8082

USER nodejs

CMD ["node", "dist/src/index.js"]
