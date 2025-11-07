# Multi-stage build for Dockaverger
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

WORKDIR /app

# Copy server package files
COPY server/package*.json ./

# Install server dependencies
RUN npm ci --only=production

# Copy server source
COPY server/ ./

# Copy built frontend from builder stage
# Server.js now serves from path.join(__dirname, "public")
# Since server.js is at /app/server.js, __dirname is /app
# So it looks for /app/public
COPY --from=frontend-builder /app/client/build ./public

# Expose port
EXPOSE 3001

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3001

# Start server
CMD ["node", "server.js"]

