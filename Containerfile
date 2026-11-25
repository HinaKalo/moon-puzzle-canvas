FROM docker.io/library/node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY fonts.mjs graph.mjs graph.test.mjs index.html src.jsx style.css ./
COPY public/canvas-login.css ./public/
RUN npm run check && npm run build && npm prune --omit=dev --no-audit --no-fund

FROM docker.io/library/node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production BIND_HOST=0.0.0.0 BOARD_DIR=/data PORT=18847
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY graph.mjs server.mjs stdio.mjs sso.mjs login-page.mjs ./
USER 1000:1000
EXPOSE 18847
CMD ["node", "server.mjs"]
