# Docked

A modern web application for managing Docker container updates through Portainer integration.

## Features

- 🔐 **Secure Authentication**: Login page protects the application
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
cd docked
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

Edit `server/.env` with your configuration:

```
PORT=3001

# Optional: Set custom admin password for the application login
# Default is "admin" if not set
ADMIN_PASSWORD=your_admin_password
```

**Note:** Portainer instances and Docker Hub credentials are now managed through the Settings UI in the application. You no longer need to configure them in the environment file.


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

### Login

When you first access the application, you'll be presented with a login page.

**Default credentials:**

- Username: `admin`
- Password: `admin` (or the value set in `ADMIN_PASSWORD` environment variable)

**Note:** For production use, you should:

1. Set a strong `ADMIN_PASSWORD` in your `.env` file (or change it in the Settings page after first login)
2. Consider using PostgreSQL or MySQL instead of SQLite for better performance and concurrent access
3. Use JWT tokens instead of simple base64 tokens
4. Regularly backup the `server/db/users.db` file

### Database

The application uses SQLite to store user credentials. The database file is located at `server/db/users.db`.

**Default user:**

- Username: `admin`
- Password: `admin` (or the value set in `ADMIN_PASSWORD` environment variable)

**Important:** Change the default password immediately after first login using the Settings page!

**Database Recommendations:**

- **SQLite** (current): Good for single-instance deployments, simple setup
- **PostgreSQL**: Recommended for production, better performance, supports concurrent connections
- **MySQL**: Alternative to PostgreSQL, also production-ready

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
- `ADMIN_PASSWORD` - Admin password for application login (default: "admin")

### Application Settings

The following are configured through the Settings UI in the application:

- **Portainer Instances**: Add, edit, and manage Portainer instances with their URLs and credentials
- **Docker Hub Authentication**: Configure Docker Hub username and Personal Access Token for higher API rate limits (200 requests/6hr vs 100 for anonymous)

**Note:** Portainer instances and Docker Hub credentials are no longer configured via environment variables. Use the Settings page after logging in.

## Notes

- The current implementation uses a simplified update check. For production use, you may want to enhance the `checkImageUpdates` function to actually query Docker Hub or your registry API to compare image tags/versions.
- The application uses the first available Portainer endpoint. To support multiple endpoints, you can extend the code.

## License

MIT
