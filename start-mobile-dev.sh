#!/bin/bash

# Docked Development Startup Script
# Starts both client and server with mobile-friendly configuration

echo "🚀 Starting Docked Mobile Development Environment..."

# Create local data directory if it doesn't exist
mkdir -p ./data/avatars

# Stop any existing processes
echo "🛑 Stopping existing processes..."
pkill -f "npm start" || true
pkill -f "node server.js" || true

# Wait for processes to stop
sleep 2

# Start server
echo "🖥️  Starting server on port 3001..."
cd server && npm start > ../server.log 2>&1 &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"

# Wait for server to start
sleep 3

# Start client
echo "📱 Starting client on port 3002..."
cd client && npm start > ../client.log 2>&1 &
CLIENT_PID=$!
echo "Client PID: $CLIENT_PID"

# Wait for client to start
sleep 5

# Check if services are running
echo "🔍 Checking services..."

if curl -s http://localhost:3002 > /dev/null; then
    echo "✅ Client is running on http://localhost:3002"
else
    echo "❌ Client failed to start"
    tail -10 ../client.log
fi

if curl -s http://localhost:3001 > /dev/null; then
    echo "✅ Server is running on http://localhost:3001"
else
    echo "❌ Server failed to start"
    tail -10 ../server.log
fi

echo ""
echo "📱 Mobile Testing URLs:"
echo "   • Main App: http://localhost:3002"
echo "   • API: http://localhost:3001"
echo "   • PWA Manifest: http://localhost:3002/manifest.json"
echo ""
echo "🔧 To test mobile:"
echo "   1. Open Chrome DevTools → Toggle device toolbar"
echo "   2. Test different device sizes (iPhone, Android, etc.)"
echo "   3. Verify bottom navigation appears on mobile (< 768px)"
echo "   4. Check PWA installability in Chrome menu"
echo ""
echo "📝 Logs:"
echo "   • Server: tail -f server.log"
echo "   • Client: tail -f client.log"
echo ""
echo "🛑 To stop: pkill -f 'npm start'"

echo "🎉 Docked Mobile Development Environment Ready!"