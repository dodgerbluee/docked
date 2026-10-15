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

# Stage 3: Final image
FROM node:25-alpine

# Set timezone
RUN apk add --no-cache tzdata
ENV TZ=America/Chicago

WORKDIR /app

# Install build tools for sqlite3 native module
RUN apk add --no-cache python3 make g++

# Install crane for container registry operations (avoids API rate limits and token management)
RUN apk add --no-cache wget && \
    wget -qO- https://github.com/google/go-containerregistry/releases/latest/download/go-containerregistry_Linux_x86_64.tar.gz | \
    tar -xz -C /tmp && \
    mv /tmp/crane /usr/local/bin/crane && \
    chmod +x /usr/local/bin/crane && \
    rm -rf /tmp/go-containerregistry* && \
    test -f /usr/local/bin/crane && echo "crane installed successfully"

# Copy Go GraphQL binary
COPY --from=backend-builder /docked-graphql /usr/local/bin/docked-graphql

# Copy root package.json (for version info)
COPY package.json ./

# Copy server package files
COPY server/package*.json ./

# Install ALL dependencies (needed to build sqlite3)
RUN npm install

# Rebuild sqlite3 from source for this architecture
RUN npm rebuild sqlite3

# Remove dev dependencies to reduce image size
RUN npm prune --production

# Copy ALL server files (including db directory)
COPY server/ ./

# Copy built frontend from builder stage
COPY --from=frontend-builder /app/client/build ./public

# Entrypoint script to run both Go and Node
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Expose port
EXPOSE 3001

# Accept NODE_ENV as build argument
ARG NODE_ENV=production

# Set environment variables
ENV NODE_ENV=${NODE_ENV}
ENV PORT=3001
ENV GRAPHQL_BACKEND=http://127.0.0.1:4000

# Start both servers
ENTRYPOINT ["docker-entrypoint.sh"]
