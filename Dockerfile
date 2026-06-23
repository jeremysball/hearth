# syntax=docker/dockerfile:1

# Builder Go version must be >= the "go" directive in server/go.mod.
FROM golang:1.26.4-alpine AS builder
WORKDIR /src/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/hearth-server .

FROM alpine:3.20
RUN addgroup -S hearth && adduser -S hearth -G hearth
WORKDIR /app
COPY --from=builder /out/hearth-server ./hearth-server
COPY index.html manifest.webmanifest styles.css sw.js ./
COPY js/ ./js/
COPY icons/ ./icons/
COPY fonts/ ./fonts/
RUN mkdir -p /app/data && chown -R hearth:hearth /app
USER hearth
ENV DB_PATH=/app/data/hearth.db
EXPOSE 8443
VOLUME ["/app/data"]
ENTRYPOINT ["./hearth-server"]
