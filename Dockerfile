# syntax=docker/dockerfile:1

# Builder Go version must be >= the "go" directive in go.mod.
FROM golang:1.26.4-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY index.html manifest.webmanifest styles.css sw.js assets.go ./
COPY js/ ./js/
COPY icons/ ./icons/
COPY server/ ./server/
COPY cmd/hearth/ ./cmd/hearth/
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
ENTRYPOINT ["/sbin/tini", "--", "./hearth-server"]
