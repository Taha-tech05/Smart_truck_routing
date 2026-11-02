# ---- deps: shared by the dev and build stages ----
FROM node:20-alpine AS deps
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci

# ---- dev: Vite dev server with hot reload (used by docker-compose.dev.yml) ----
FROM deps AS dev
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]

# ---- build: static production bundle ----
FROM deps AS build
ARG VITE_API_BASE_URL=http://localhost:8000
ARG VITE_MAP_STYLE_URL
ARG VITE_MAP_STYLE_DARK_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_MAP_STYLE_URL=$VITE_MAP_STYLE_URL \
    VITE_MAP_STYLE_DARK_URL=$VITE_MAP_STYLE_DARK_URL \
    VITE_USE_MOCKS=false
COPY . .
RUN npm run build

# ---- final: nginx serves dist/ ----
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD wget -qO /dev/null http://127.0.0.1/ || exit 1
