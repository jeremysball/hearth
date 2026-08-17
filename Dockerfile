# syntax=docker/dockerfile:1

# Builder image needs Node (for `npm run build` -> dist/) and Go (embed).
FROM golang:1.26.4-alpine AS builder
RUN apk add --no-cache nodejs npm
WORKDIR /src

# Cache npm install separately from source so JS-only changes don't bust
# the dependency layer.
COPY package.json package-lock.json vite.config.js ./
RUN npm ci

# Source: handlers, embedded assets (under public/), hand-written service
# worker (post-build patched by scripts/patch-sw.mjs), scripts/, and Go.
COPY public/ ./public/
COPY js/ ./js/
COPY index.html styles.css sw.js assets.go assets_test.go ./
COPY scripts/ ./scripts/
COPY server/ ./server/
COPY cmd/hearth/ ./cmd/hearth/
COPY go.mod go.sum ./

# Vite turns public/ + index.html into dist/static/<hash>.{js,css},
# dist/{index.html,sw.js,manifest.webmanifest,icons/,assets/}. The
# patcher rewrites the SHELL array in dist/sw.js to point at the
# hashed entry chunk URLs.
RUN npm run build

RUN CGO_ENABLED=0 GOOS=linux go build -o /out/hearth-server ./cmd/hearth

FROM alpine:3.20
RUN apk add --no-cache tini
RUN addgroup -S hearth && adduser -S hearth -G hearth
WORKDIR /app
COPY --from=builder /out/hearth-server ./hearth-server
RUN mkdir -p /app/data && chown -R hearth:hearth /app
USER hearth
ENV DB_PATH=/app/data/hearth.db
EXPOSE 8443
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["./hearth-server", "healthcheck"]
ENTRYPOINT ["/sbin/tini", "--", "./hearth-server"]
