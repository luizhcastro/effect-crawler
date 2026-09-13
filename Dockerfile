FROM oven/bun:1.3.2-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src
COPY tsconfig.json ./

ENV NODE_ENV=production
EXPOSE 3000

# One process: HTTP, the scheduler, and the workers. Migrations run at startup.
CMD ["bun", "src/main.ts"]
