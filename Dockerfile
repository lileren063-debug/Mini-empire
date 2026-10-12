# Mini Empire — single image: builds the client, runs the API server (which also serves the client).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build -w client

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
RUN npm prune --omit=dev --workspaces --include-workspace-root=false 2>/dev/null || true
# tsx runs the TypeScript server directly (no separate compile step).
RUN npm i -g tsx@4
USER node
EXPOSE 3000
CMD ["tsx", "server/src/index.ts"]
