FROM node:22-bookworm-slim AS build
WORKDIR /app

# 先安装依赖以利用 Docker 分层缓存，再编译 TypeScript。
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# 运行阶段只保留生产依赖、编译产物和运行时配置/知识库。
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY config ./config
COPY knowledge ./knowledge

USER node
EXPOSE 8080
CMD ["node", "dist/api/agent-api-server.js"]
