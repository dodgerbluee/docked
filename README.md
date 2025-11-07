# Dockaverger

A modern web application for managing Docker container updates through Portainer integration.

## Features

- 🔍 **Automatic Update Detection**: Scans your Docker containers and identifies available updates
- 🎨 **Modern UI**: Clean, responsive interface with real-time status updates
- 🔄 **One-Click Upgrades**: Upgrade containers with a single click
- 🔌 **Portainer Integration**: Seamlessly connects to your Portainer instance

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Portainer instance running and accessible
- Docker containers managed by Portainer

## Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd dockaverger
```

2. Install all dependencies:

```bash
npm run install-all
```

3. Configure the backend:

```bash
cd server
cp .env.example .env
```

Edit `server/.env` with your Portainer credentials:

```
PORT=3001
PORTAINER_URL=http://localhost:9000
PORTAINER_USERNAME=admin
PORTAINER_PASSWORD=your_password_here
```

**Important:** If your password contains special characters (like `#`, `$`, spaces, etc.), you **must** wrap it in quotes:

```
PORTAINER_PASSWORD="my#password$123"
```

Without quotes, characters like `#` will be treated as comments and the password will be truncated.

## Usage

### Development Mode

Run both frontend and backend concurrently:

```bash
npm run dev
```

Or run them separately:

**Backend only:**

```bash
npm run server
```

**Frontend only:**

```bash
npm run client
```

### Access the Application

- Frontend: http://localhost:3000
- Backend API: http://localhost:3001

## How It Works

1. **Backend** (`server/index.js`):

   - Authenticates with Portainer API
   - Fetches all containers from Portainer
   - Checks for available image updates
   - Provides REST API endpoints for the frontend

2. **Frontend** (`client/src/App.js`):
   - Displays containers with available updates
   - Shows container status and image information
   - Provides upgrade buttons for containers with updates
   - Auto-refreshes every 30 seconds

## API Endpoints

- `GET /api/health` - Health check
- `GET /api/containers` - Get all containers with update status
- `POST /api/containers/:containerId/upgrade` - Upgrade a specific container

## Upgrade Process

When you click "Upgrade Now" on a container:

1. The container is stopped
2. The latest image is pulled
3. The old container is removed
4. A new container is created with the same configuration
5. The new container is started

## Configuration

### Environment Variables

- `PORT` - Backend server port (default: 3001)
- `PORTAINER_URL` - Portainer API URL (default: http://localhost:9000)
- `PORTAINER_USERNAME` - Portainer username
- `PORTAINER_PASSWORD` - Portainer password

## Notes

- The current implementation uses a simplified update check. For production use, you may want to enhance the `checkImageUpdates` function to actually query Docker Hub or your registry API to compare image tags/versions.
- The application uses the first available Portainer endpoint. To support multiple endpoints, you can extend the code.

## License

MIT
