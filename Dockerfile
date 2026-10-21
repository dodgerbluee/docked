# Multi-stage build for Docked
# Stage 1: Build React frontend
FROM node:25-alpine AS frontend-builder

WORKDIR /app/client

# Copy client package files and npm config
COPY client/package*.json ./
COPY client/.npmrc ./

# Install client dependencies
RUN npm install

# Copy client source
COPY client/ ./

# Build React app
RUN npm run build

# Stage 2: Build Go GraphQL backend
FROM golang:1.26-alpine AS backend-builder

WORKDIR /app/backend

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ ./

RUN CGO_ENABLED=0 go build -o /docked-graphql ./cmd/api

# Stage 3: Final image — Go binary only (Node fully retired in phase 8d;
# Node above is build-time only)
FROM alpine:3.22

# Timezone + CA certs (Go needs /etc/ssl/certs for registry/OAuth/Discord HTTPS)
RUN apk add --no-cache tzdata ca-certificates
ENV TZ=America/Chicago

WORKDIR /app

# Copy Go GraphQL binary
COPY --from=backend-builder /docked-graphql /usr/local/bin/docked-graphql

# Copy root package.json (version info served by /api/version)
COPY package.json ./

# Copy built frontend from builder stage
COPY --from=frontend-builder /app/client/build ./public

# Expose port (served by the Go binary directly since phase 8c; the host
# edge keeps pointing at this same port — no external config change)
EXPOSE 3001

# Accept NODE_ENV as build argument
ARG NODE_ENV=production

# Set environment variables
ENV NODE_ENV=${NODE_ENV}
# Go listens on the historical Node port so the container's published port
# and the host edge config stay untouched. PORT (not ADDR) so docker-compose
# PORT overrides win; an explicit ADDR still takes precedence.
ENV PORT=3001
# Go is the edge: apply helmet/CORS ports on its own responses.
ENV EDGE_SERVE=true

# Start the server (Go runs its own DB migrations before opening the port)
ENTRYPOINT ["docked-graphql"]
