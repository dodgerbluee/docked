# Multi-stage build for Docked
# Stage 1: Build React frontend
FROM node:18-alpine AS frontend-builder

WORKDIR /app/client

# Copy client package files
COPY client/package*.json ./

# Install client dependencies
RUN npm install

# Copy client source
COPY client/ ./

# Build React app
RUN npm run build

# Stage 2: Build backend and serve frontend
FROM node:18-alpine

# Set timezone
RUN apk add --no-cache tzdata
ENV TZ=America/Chicago

WORKDIR /app

# Install build tools for sqlite3 native module
RUN apk add --no-cache python3 make g++

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

# Expose port
EXPOSE 3001

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3001

# Start server
CMD ["node", "server.js"]
