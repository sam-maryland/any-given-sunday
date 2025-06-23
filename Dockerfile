# Dockerfile for Discord Bot (commish-bot)
FROM golang:1.21-alpine AS builder

WORKDIR /app

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build only the commish-bot application
RUN CGO_ENABLED=0 GOOS=linux go build -o commish-bot ./cmd/commish-bot

# Use a minimal base image
FROM alpine:latest

RUN apk --no-cache add ca-certificates
WORKDIR /root/

# Copy the binary from builder stage
COPY --from=builder /app/commish-bot .

# Cloud Run requires the app to listen on PORT env var
ENV PORT=8080

CMD ["./commish-bot"]